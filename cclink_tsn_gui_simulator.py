#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CC-Link IE TSN Class A 多機種、多站桌面圖形介面模擬器 (Tkinter GUI)
====================================================================
功能總覽：
1. 完整支援 6 款三菱電機原廠 CSP+ 描述檔遠端站模組：
   - 數位模組：NZ2GNCF1-32T, NZ2GN2S1-32T, NZ2GN2S1-32D, NZ2GN2S1-32DT
   - 類比模組：NZ2GN2S-60AD4 (4ch A/D), NZ2GN2S-60DA4 (4ch D/A)
2. 支援兩種 UDP Socket 監聽架構（Port 61450）：
   - 【預設】0.0.0.0 萬用監聽模式：免設定本機次要 IP，徹底解決 Windows WinError 10049 錯誤，
     依封包第 8 Byte 之站號 (Station No) 自動路由至對應模擬站點處理並回應。
   - 【進階】獨立 IP 綁定模式：搭配 netsh 指令於網卡配置次要 IP 後，各站獨立開啟執行緒監聽。
3. 內建視覺化 I/O 控制工作台（X/Y 數位接點切換、4 通道類比滑桿與電壓換算）。
4. 內建即時封包監控面板 (Packet Sniffer) 與欄位解析器 (Hex Dissector)。
5. 內建從站管理列表，支援動態新增、修改、刪除站點，以及 Cycle Time / Jitter 連線品質監測。
6. 100% 原生 Python 3.8+ 標準函式庫 (tkinter / socket / struct / threading / queue)，無須 pip 安裝。
"""

import datetime
import queue
import socket
import struct
import threading
import time
import tkinter as tk
from dataclasses import dataclass, field
from tkinter import ttk, messagebox
from typing import Dict, List, Optional

# ==============================================================================
# 1. 支援機種規格目錄 (Device Catalog - 依據原廠 CSP+ XML 解析彙整)
# ==============================================================================
# ready_in_rwr 說明：
#   - True  (數位模組): Remote Ready 旗標位於 RWr0.b11，錯誤碼位於 RWr1
#   - False (類比模組): Remote Ready 旗標位於 RXB (RX bit 11)，異常在 RXA，錯誤碼在 RWr0
DEVICE_CATALOG = {
    "NZ2GNCF1-32T": {
        "model": "NZ2GNCF1-32T",
        "name": "32點電晶體輸出模組 (40-Pin 插針型)",
        "vendor_code": 0x0000,
        "model_code": 0x60010192,
        "device_type": 0x0003,
        "category": "DO",
        "rx_bits": 32, "ry_bits": 32, "rwr_words": 4, "rww_words": 4,
        "ready_in_rwr": True,
    },
    "NZ2GN2S1-32T": {
        "model": "NZ2GN2S1-32T",
        "name": "32點電晶體輸出模組 (彈簧夾端子台型)",
        "vendor_code": 0x0000,
        "model_code": 0x60010092,
        "device_type": 0x0003,
        "category": "DO",
        "rx_bits": 32, "ry_bits": 32, "rwr_words": 4, "rww_words": 4,
        "ready_in_rwr": True,
    },
    "NZ2GN2S1-32D": {
        "model": "NZ2GN2S1-32D",
        "name": "32點數位DC輸入模組 (彈簧夾端子台型)",
        "vendor_code": 0x0000,
        "model_code": 0x60010890,
        "device_type": 0x0003,
        "category": "DI",
        "rx_bits": 32, "ry_bits": 32, "rwr_words": 4, "rww_words": 4,
        "ready_in_rwr": True,
    },
    "NZ2GN2S1-32DT": {
        "model": "NZ2GN2S1-32DT",
        "name": "16點輸入 / 16點輸出 複合模組",
        "vendor_code": 0x0000,
        "model_code": 0x60010894,
        "device_type": 0x0003,
        "category": "DIO",
        "rx_bits": 32, "ry_bits": 32, "rwr_words": 4, "rww_words": 4,
        "ready_in_rwr": True,
    },
    "NZ2GN2S-60AD4": {
        "model": "NZ2GN2S-60AD4",
        "name": "4通道高精度類比輸入模組 (A/D)",
        "vendor_code": 0x0000,
        "model_code": 0x50000002,
        "device_type": 0x0004,
        "category": "AI",
        "rx_bits": 32, "ry_bits": 32, "rwr_words": 16, "rww_words": 16,
        "ready_in_rwr": False,
    },
    "NZ2GN2S-60DA4": {
        "model": "NZ2GN2S-60DA4",
        "name": "4通道高精度類比輸出模組 (D/A)",
        "vendor_code": 0x0000,
        "model_code": 0x50000004,
        "device_type": 0x0004,
        "category": "AO",
        "rx_bits": 32, "ry_bits": 32, "rwr_words": 32, "rww_words": 32,
        "ready_in_rwr": False,
    },
}


# ==============================================================================
# 2. 單站設備實體與週期封包緩衝區管理 (DeviceStation)
# ==============================================================================
@dataclass
class DeviceStation:
    """代表單一 CC-Link IE TSN Class A 模擬從站與其循環記憶體緩衝區"""
    station_no: int
    ip_address: str
    model_name: str
    udp_port: int = 61450
    enabled: bool = True

    # 四大循環通訊資料區：RX/RWr (從站->主站)、RY/RWw (主站->從站)
    rx_buffer: bytearray = field(init=False)
    ry_buffer: bytearray = field(init=False)
    rwr_buffer: bytearray = field(init=False)
    rww_buffer: bytearray = field(init=False)

    # 握手狀態旗標與統計指標
    remote_ready: bool = True
    condition_set_comp: bool = True
    error_code: int = 0x0000
    sequence_no: int = 0
    running: bool = False
    sock: Optional[socket.socket] = None

    # 連線品質計算欄位（滑動視窗平均週期與抖動）
    last_seen_time: float = 0.0
    packet_count: int = 0
    cycle_time_ms: float = 16.0
    jitter_ms: float = 0.3
    quality: str = "🟢 穩定"
    history_intervals: List[float] = field(default_factory=list)

    def __post_init__(self):
        self.init_buffers_for_model(self.model_name)

    def init_buffers_for_model(self, model_name: str):
        """依據指定機種規格初始化 RX / RY / RWr / RWw 緩衝區大小"""
        self.model_name = model_name
        self.spec = DEVICE_CATALOG.get(model_name, DEVICE_CATALOG["NZ2GNCF1-32T"])
        self.rx_buffer = bytearray(self.spec["rx_bits"] // 8)
        self.ry_buffer = bytearray(self.spec["ry_bits"] // 8)
        self.rwr_buffer = bytearray(self.spec["rwr_words"] * 2)
        self.rww_buffer = bytearray(self.spec["rww_words"] * 2)
        self.update_buffers()

    def update_buffers(self):
        """將 Ready / 條件完成 / Error Code 寫入對應暫存器（Little-Endian）"""
        if self.spec["ready_in_rwr"]:
            # 數位 I/O 模組：Ready = RWr0.b11, InitComp = RWr0.b9, Error = RWr1
            rwr0 = 0
            if self.condition_set_comp:
                rwr0 |= (1 << 9)
            if self.remote_ready and self.error_code == 0:
                rwr0 |= (1 << 11)
            struct.pack_into("<H", self.rwr_buffer, 0, rwr0)
            struct.pack_into("<H", self.rwr_buffer, 2, self.error_code)
            struct.pack_into("<H", self.rwr_buffer, 4, 0x0B00)
        else:
            # 類比模組：Ready = RXB (Bit 11), ErrorFlag = RXA (Bit 10), Error = RWr0
            rx_val = struct.unpack_from("<I", self.rx_buffer, 0)[0]
            rx_val &= ~((1 << 9) | (1 << 10) | (1 << 11))
            if self.condition_set_comp:
                rx_val |= (1 << 9)
            if self.error_code != 0:
                rx_val |= (1 << 10)
            if self.remote_ready and self.error_code == 0:
                rx_val |= (1 << 11)
            struct.pack_into("<I", self.rx_buffer, 0, rx_val)
            struct.pack_into("<H", self.rwr_buffer, 0, self.error_code)

    def record_packet_arrival(self):
        """記錄封包到達時間並計算最近 20 筆之平均通訊週期 (Cycle Time) 與抖動 (Jitter)"""
        now = time.time()
        self.packet_count += 1
        if self.last_seen_time > 0:
            dt_ms = (now - self.last_seen_time) * 1000.0
            # 過濾合理掃描區間 (0.5ms ~ 300ms) 以避免暫停重啟造成的極端跳值
            if 0.5 <= dt_ms <= 300.0:
                self.history_intervals.append(dt_ms)
                if len(self.history_intervals) > 20:
                    self.history_intervals.pop(0)
                avg_cycle = sum(self.history_intervals) / len(self.history_intervals)
                jitter = sum(abs(x - avg_cycle) for x in self.history_intervals) / len(self.history_intervals)
                self.cycle_time_ms = round(avg_cycle, 1)
                self.jitter_ms = round(jitter, 1)

                if self.jitter_ms <= 1.2:
                    self.quality = "🟢 穩定"
                elif self.jitter_ms <= 3.0:
                    self.quality = "🟡 輕微抖動"
                else:
                    self.quality = "🔴 延遲過大"
        self.last_seen_time = now

    def pack_cyclic_response(self) -> bytes:
        """
        打包從站週期回覆封包 (Slave -> Master)
        Header (10 Bytes, Big-Endian '!HIHBb'):
          - [0..1] Magic      : 0xCC1E (2B)
          - [2..5] Model Code : CSP+ 機種識別碼 (4B)
          - [6..7] Seq No     : 遞增封包序號 (2B)
          - [8]    Station No : 從站站號 (1B)
          - [9]    Status     : 0x00 正常 (1B)
        Payload (Little-Endian): RX Buffer + RWr Buffer
        """
        self.update_buffers()
        self.sequence_no = (self.sequence_no + 1) & 0xFFFF
        header = struct.pack(
            "!HIHBb",
            0xCC1E,
            self.spec["model_code"],
            self.sequence_no,
            self.station_no,
            0x00
        )
        return header + bytes(self.rx_buffer) + bytes(self.rwr_buffer)

    def unpack_cyclic_command(self, payload: bytes):
        """解析主站發來的週期指令 (Master -> Slave)，將 RY 與 RWw 寫入本地緩衝區"""
        header_len = 10
        if len(payload) >= header_len:
            data = payload[header_len:]
            ry_len = len(self.ry_buffer)
            rww_len = len(self.rww_buffer)
            if len(data) >= ry_len:
                self.ry_buffer[:] = data[0:ry_len]
            if len(data) >= ry_len + rww_len:
                self.rww_buffer[:] = data[ry_len:ry_len + rww_len]
        self.update_buffers()

    def set_digital_input(self, bit_index: int, value: bool):
        """設定數位輸入點位 (X0 ~ X1F) 寫入 rx_buffer"""
        if 0 <= bit_index < len(self.rx_buffer) * 8:
            byte_idx = bit_index // 8
            bit_pos = bit_index % 8
            if value:
                self.rx_buffer[byte_idx] |= (1 << bit_pos)
            else:
                self.rx_buffer[byte_idx] &= ~(1 << bit_pos)

    def get_digital_output(self, bit_index: int) -> bool:
        """讀取主站驅動的數位輸出點位 (Y0 ~ Y1F)"""
        if 0 <= bit_index < len(self.ry_buffer) * 8:
            return bool(self.ry_buffer[bit_index // 8] & (1 << (bit_index % 8)))
        return False

    def set_analog_input(self, channel: int, digital_val: int):
        """設定類比輸入模組 (60AD4) CH1~4 數值至 RWr2~RWr5"""
        if 1 <= channel <= 4:
            offset = (1 + channel) * 2
            struct.pack_into("<h", self.rwr_buffer, offset, int(digital_val))

    def get_analog_output(self, channel: int) -> int:
        """讀取主站寫入類比輸出模組 (60DA4) RWw2~RWw5 之 CH1~4 數值"""
        if 1 <= channel <= 4:
            offset = (1 + channel) * 2
            return struct.unpack_from("<h", self.rww_buffer, offset)[0]
        return 0


# ==============================================================================
# 3. 桌面 GUI 應用程式主體 (Tkinter Desktop Application)
# ==============================================================================
class CCLinkTSNSimulatorGUI:
    """CC-Link IE TSN 多站模擬器桌面視窗控制器"""

    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("CC-Link IE TSN Class A 多站模擬器 (GUI 控制台)")
        self.root.geometry("1020x720")
        self.root.minsize(920, 640)

        # 使用 Queue 確保背景 Socket 執行緒能安全更新 Tkinter 主執行緒畫面
        self.ui_queue: queue.Queue = queue.Queue()

        # 站點儲存字典 (Key: 站號 int) 與背景執行緒清單
        self.stations: Dict[int, DeviceStation] = {}
        self.threads: List[threading.Thread] = []
        self.is_running = False
        self.sniffing_active = True

        # 預設載入 3 組常見測試站點 (輸出、輸入、類比)
        self.add_station(1, "192.168.3.10", "NZ2GNCF1-32T")
        self.add_station(2, "192.168.3.11", "NZ2GN2S1-32D")
        self.add_station(3, "192.168.3.12", "NZ2GN2S-60AD4")

        # UI 選擇狀態變數
        self.selected_st_no = tk.IntVar(value=1)
        self.selected_edit_st_no: Optional[int] = None

        # 預設啟用 0.0.0.0 萬用監聽，徹底避免 Windows 未配置次要 IP 時發生 WinError 10049
        self.bind_all_interfaces = tk.BooleanVar(value=True)
        self.shared_sock: Optional[socket.socket] = None

        # 建構 UI 版面與元件
        self._setup_style()
        self._build_top_bar()
        self._build_notebook()
        self._build_status_bar()

        # 啟動每 50ms 輪詢一次非同步 UI 事件佇列
        self.root.after(50, self._process_ui_queue)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    def _setup_style(self):
        style = ttk.Style()
        style.theme_use("clam")
        style.configure("Treeview", font=("Consolas", 9), rowheight=24)
        style.configure("Treeview.Heading", font=("Microsoft JhengHei UI", 9, "bold"))
        style.configure("TButton", font=("Microsoft JhengHei UI", 9))
        style.configure("TLabel", font=("Microsoft JhengHei UI", 9))

    def _build_top_bar(self):
        """建立頂部全域工具列：站點選擇、監聽模式開關、網卡診斷與啟動控制"""
        frame = ttk.Frame(self.root, padding="10 8 10 8")
        frame.pack(fill=tk.X)

        ttk.Label(
            frame,
            text="CC-Link IE TSN 從站模擬器",
            font=("Microsoft JhengHei UI", 12, "bold"),
            foreground="#0052cc"
        ).pack(side=tk.LEFT, padx=(0, 15))

        # 調試站點下拉選單
        ttk.Label(frame, text="調試站點:").pack(side=tk.LEFT, padx=(5, 2))
        self.st_combo = ttk.Combobox(
            frame,
            textvariable=self.selected_st_no,
            values=list(self.stations.keys()),
            width=5,
            state="readonly"
        )
        self.st_combo.pack(side=tk.LEFT, padx=(0, 10))
        self.st_combo.bind("<<ComboboxSelected>>", lambda e: self._refresh_workbench())

        # 即時顯示當前調試機種型號、類別與 Ready 位址
        self.st_info_lbl = ttk.Label(
            frame,
            text="",
            font=("Consolas", 9, "bold"),
            foreground="#0052cc"
        )
        self.st_info_lbl.pack(side=tk.LEFT, padx=(5, 12))

        # 萬用監聽切換核取方塊 (解決 WinError 10049)
        ttk.Checkbutton(
            frame,
            text="0.0.0.0 萬用監聽 (防 10049/免設次要 IP)",
            variable=self.bind_all_interfaces
        ).pack(side=tk.LEFT, padx=(5, 5))

        # Windows 網卡診斷與 netsh 腳本視窗按鈕
        ttk.Button(
            frame,
            text="🔍 網卡診斷/netsh 指令",
            command=self._show_network_diagnostics
        ).pack(side=tk.LEFT, padx=(5, 10))

        # 啟動 / 停止全體監聽按鈕
        self.btn_toggle_all = tk.Button(
            frame,
            text="▶ 啟動全部從站監聽",
            bg="#28a745",
            fg="white",
            font=("Microsoft JhengHei UI", 9, "bold"),
            relief=tk.FLAT,
            padx=12,
            pady=4,
            command=self.toggle_simulator
        )
        self.btn_toggle_all.pack(side=tk.RIGHT, padx=5)

    def _build_notebook(self):
        """建立三大功能分頁：I/O 工作台、封包監控面板、從站管理列表"""
        self.notebook = ttk.Notebook(self.root)
        self.notebook.pack(fill=tk.BOTH, expand=True, padx=10, pady=5)

        self.tab_io = ttk.Frame(self.notebook, padding=10)
        self.notebook.add(self.tab_io, text=" 1. 記憶體映射與 I/O 工作台 ")

        self.tab_sniffer = ttk.Frame(self.notebook, padding=10)
        self.notebook.add(self.tab_sniffer, text=" 2. 即時封包監控面板 (Sniffer) ")

        self.tab_manager = ttk.Frame(self.notebook, padding=10)
        self.notebook.add(self.tab_manager, text=" 3. 模擬從站管理列表 ")

        self._build_tab_io_content()
        self._build_tab_sniffer_content()
        self._build_tab_manager_content()
        self._refresh_workbench()

    # --------------------------------------------------------------------------
    # Tab 1: I/O 記憶體映射與控制工作台
    # --------------------------------------------------------------------------
    def _build_tab_io_content(self):
        ctrl_frame = ttk.LabelFrame(self.tab_io, text="從站握手與狀態旗標 (Handshake & Status)", padding=10)
        ctrl_frame.pack(fill=tk.X, pady=(0, 10))

        self.var_ready = tk.BooleanVar(value=True)
        ttk.Checkbutton(
            ctrl_frame,
            text="Remote Ready (正常就緒)",
            variable=self.var_ready,
            command=self._on_flag_changed
        ).pack(side=tk.LEFT, padx=10)

        self.var_cond = tk.BooleanVar(value=True)
        ttk.Checkbutton(
            ctrl_frame,
            text="Condition / Initial Data Complete",
            variable=self.var_cond,
            command=self._on_flag_changed
        ).pack(side=tk.LEFT, padx=10)

        ttk.Label(ctrl_frame, text="Error Code (HEX):").pack(side=tk.LEFT, padx=(20, 2))
        self.var_err = tk.StringVar(value="0000")
        self.ent_err = ttk.Entry(ctrl_frame, textvariable=self.var_err, width=8, font=("Consolas", 9))
        self.ent_err.pack(side=tk.LEFT)
        self.ent_err.bind("<FocusOut>", lambda e: self._on_flag_changed())

        # 動態渲染區（依當前站點為數位或類比模組而切換元件）
        self.io_container = ttk.Frame(self.tab_io)
        self.io_container.pack(fill=tk.BOTH, expand=True)

    def _refresh_workbench(self):
        """當切換調試站點或修改機種時，重新繪製工作台 I/O 控制元件"""
        st_no = self.selected_st_no.get()
        if st_no not in self.stations:
            return

        st = self.stations[st_no]
        if hasattr(self, "st_info_lbl") and self.st_info_lbl:
            ready_loc = "RWr0.b11" if st.spec["ready_in_rwr"] else "RXB"
            self.st_info_lbl.config(
                text=f"IP: {st.ip_address} | {st.spec['model']} ({st.spec['category']}) | Ready: {ready_loc}"
            )
        self.var_ready.set(st.remote_ready)
        self.var_cond.set(st.condition_set_comp)
        self.var_err.set(f"{st.error_code:04X}")

        for child in self.io_container.winfo_children():
            child.destroy()

        category = st.spec["category"]
        if category in ("DI", "DO", "DIO"):
            self._render_digital_ui(st)
        elif category in ("AI", "AO"):
            self._render_analog_ui(st)

    def _render_digital_ui(self, st: DeviceStation):
        """繪製數位輸入 (RX) 開關按鈕與數位輸出 (RY) LED 監視格子"""
        rx_frame = ttk.LabelFrame(self.io_container, text="數位輸入 X 接點 (Slave -> Master 傳送狀態)", padding=10)
        rx_frame.pack(fill=tk.X, pady=(0, 10))

        self.rx_btns: List[tk.Checkbutton] = []
        self.rx_vars: List[tk.BooleanVar] = []
        grid_frame = ttk.Frame(rx_frame)
        grid_frame.pack()

        pts = 16 if st.spec["category"] == "DIO" else 32
        for i in range(pts):
            var = tk.BooleanVar(value=bool(st.rx_buffer[i // 8] & (1 << (i % 8))))
            self.rx_vars.append(var)
            btn = tk.Checkbutton(
                grid_frame,
                text=f"X{i:X}",
                variable=var,
                font=("Consolas", 8),
                indicatoron=False,
                selectcolor="#28a745",
                width=4,
                padx=2,
                pady=2,
                command=lambda idx=i, v=var: self._on_rx_toggle(idx, v.get())
            )
            btn.grid(row=i // 16, column=i % 16, padx=2, pady=2)
            self.rx_btns.append(btn)

        ry_frame = ttk.LabelFrame(self.io_container, text="數位輸出 Y 接點 (Master PLC 驅動監視)", padding=10)
        ry_frame.pack(fill=tk.X)

        self.ry_labels: List[tk.Label] = []
        grid_ry = ttk.Frame(ry_frame)
        grid_ry.pack()

        offset = 16 if st.spec["category"] == "DIO" else 0
        for i in range(pts):
            actual_idx = i + offset
            val = st.get_digital_output(actual_idx)
            lbl = tk.Label(
                grid_ry,
                text=f"Y{actual_idx:X}\n{'1' if val else '0'}",
                font=("Consolas", 8),
                bg="#007bff" if val else "#e0e0e0",
                fg="white" if val else "#666",
                width=4,
                height=2,
                relief=tk.GROOVE
            )
            lbl.grid(row=i // 16, column=i % 16, padx=2, pady=2)
            self.ry_labels.append(lbl)

    def _render_analog_ui(self, st: DeviceStation):
        """繪製 4 通道類比輸入滑桿 (60AD4) 或類比輸出監視表 (60DA4)"""
        category = st.spec["category"]
        frame = ttk.LabelFrame(
            self.io_container,
            text=f"4 通道類比控制 ({category}: -32000 ~ +32000)",
            padding=15
        )
        frame.pack(fill=tk.BOTH, expand=True)

        self.analog_scales: List[tk.Scale] = []
        self.analog_lbls: List[tk.Label] = []

        for ch in range(1, 5):
            ch_box = ttk.Frame(frame, padding=10, relief=tk.RIDGE)
            ch_box.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=5)

            if category == "AI":
                val = struct.unpack_from("<h", st.rwr_buffer, (1 + ch) * 2)[0]
                ttk.Label(ch_box, text=f"CH{ch} 輸入 (RWr{ch+1})", font=("Microsoft JhengHei UI", 9, "bold")).pack()
                val_lbl = ttk.Label(ch_box, text=f"{val} LSB", font=("Consolas", 10, "bold"), foreground="#d97706")
                val_lbl.pack(pady=5)

                scale = tk.Scale(
                    ch_box,
                    from_=-32000,
                    to=32000,
                    resolution=100,
                    orient=tk.VERTICAL,
                    length=200,
                    command=lambda v, c=ch, l=val_lbl: self._on_analog_change(c, int(v), l)
                )
                scale.set(val)
                scale.pack(pady=5)
                self.analog_scales.append(scale)
            else:
                val = st.get_analog_output(ch)
                ttk.Label(ch_box, text=f"CH{ch} 輸出 (RWw{ch+1})", font=("Microsoft JhengHei UI", 9, "bold")).pack()
                lbl = tk.Label(
                    ch_box,
                    text=f"{val}\n(~{(val/16000*10):.2f} V)",
                    font=("Consolas", 12, "bold"),
                    bg="#f3e8ff",
                    fg="#6b21a8",
                    width=12,
                    height=4,
                    relief=tk.SUNKEN
                )
                lbl.pack(pady=20)
                self.analog_lbls.append(lbl)

    def _on_rx_toggle(self, bit_idx: int, val: bool):
        st_no = self.selected_st_no.get()
        if st_no in self.stations:
            self.stations[st_no].set_digital_input(bit_idx, val)

    def _on_analog_change(self, ch: int, val: int, lbl: ttk.Label):
        lbl.config(text=f"{val} LSB")
        st_no = self.selected_st_no.get()
        if st_no in self.stations:
            self.stations[st_no].set_analog_input(ch, val)

    def _on_flag_changed(self):
        st_no = self.selected_st_no.get()
        if st_no in self.stations:
            st = self.stations[st_no]
            st.remote_ready = self.var_ready.get()
            st.condition_set_comp = self.var_cond.get()
            try:
                st.error_code = int(self.var_err.get(), 16)
            except ValueError:
                st.error_code = 0
            st.update_buffers()

    # --------------------------------------------------------------------------
    # Tab 2: 即時封包監控面板 (Packet Sniffer & Hex Dissector)
    # --------------------------------------------------------------------------
    def _build_tab_sniffer_content(self):
        toolbar = ttk.Frame(self.tab_sniffer)
        toolbar.pack(fill=tk.X, pady=(0, 5))

        self.btn_pause = ttk.Button(toolbar, text="暫停擷取", command=self._toggle_sniffer)
        self.btn_pause.pack(side=tk.LEFT, padx=2)

        ttk.Button(toolbar, text="清空封包", command=self._clear_packets).pack(side=tk.LEFT, padx=2)

        ttk.Button(
            toolbar,
            text="模擬發送主站封包",
            command=self._simulate_master_packet
        ).pack(side=tk.LEFT, padx=10)

        columns = ("time", "dir", "st", "ip", "seq", "len", "hex")
        self.tree = ttk.Treeview(self.tab_sniffer, columns=columns, show="headings", height=12)
        self.tree.heading("time", text="時間戳")
        self.tree.heading("dir", text="方向")
        self.tree.heading("st", text="站號")
        self.tree.heading("ip", text="來源/目的 IP")
        self.tree.heading("seq", text="序號")
        self.tree.heading("len", text="長度")
        self.tree.heading("hex", text="原始 Hex 數據")

        self.tree.column("time", width=100)
        self.tree.column("dir", width=85)
        self.tree.column("st", width=50)
        self.tree.column("ip", width=130)
        self.tree.column("seq", width=70)
        self.tree.column("len", width=55)
        self.tree.column("hex", width=450)

        self.tree.pack(fill=tk.BOTH, expand=True)
        self.tree.bind("<<TreeviewSelect>>", self._on_packet_selected)

        # 下方暗色欄位解析器視窗
        self.txt_dissect = tk.Text(self.tab_sniffer, height=6, font=("Consolas", 9), bg="#1e1e1e", fg="#d4d4d4")
        self.txt_dissect.pack(fill=tk.X, pady=(5, 0))
        self.txt_dissect.insert(tk.END, "點擊上方任一封包，在此查看 CC-Link IE TSN 欄位詳細拆解。")

    def _toggle_sniffer(self):
        self.sniffing_active = not self.sniffing_active
        self.btn_pause.config(text="繼續擷取" if not self.sniffing_active else "暫停擷取")

    def _clear_packets(self):
        for item in self.tree.get_children():
            self.tree.delete(item)
        self.txt_dissect.delete("1.0", tk.END)

    def _on_packet_selected(self, event):
        selected = self.tree.selection()
        if not selected:
            return
        item = self.tree.item(selected[0])
        raw_hex = item["values"][6]
        tokens = raw_hex.split()
        if len(tokens) >= 10:
            magic = f"{tokens[0]} {tokens[1]}"
            mc = f"{tokens[2]} {tokens[3]} {tokens[4]} {tokens[5]}"
            seq = f"{tokens[6]} {tokens[7]}"
            st_no = tokens[8]
            status = tokens[9]
            payload = " ".join(tokens[10:])

            desc = (
                "=== CC-Link IE TSN 封包欄位剖析 ===\n"
                f"[00..01] Magic TSN      : 0x{magic.replace(' ', '')} (CC-Link IE TSN 循環幀)\n"
                f"[02..05] Model Code     : 0x{mc.replace(' ', '')}\n"
                f"[06..07] Sequence No    : 0x{seq.replace(' ', '')} ({int(seq.replace(' ', ''), 16)})\n"
                f"[08]     Station No     : #{int(st_no, 16)}\n"
                f"[09]     Link Status    : 0x{status} (正常資料鏈路)\n"
                f"[10..]   Data Payload   : {payload}\n"
            )
            self.txt_dissect.delete("1.0", tk.END)
            self.txt_dissect.insert(tk.END, desc)

    # --------------------------------------------------------------------------
    # Tab 3: 模擬從站管理列表 (新增 / 修改 / 刪除 / 品質監控)
    # --------------------------------------------------------------------------
    def _build_tab_manager_content(self):
        add_frame = ttk.LabelFrame(self.tab_manager, text="從站配置管理 (新增 / 修改 / 刪除)", padding=10)
        add_frame.pack(fill=tk.X, pady=(0, 10))

        # 表單輸入列
        in_row = ttk.Frame(add_frame)
        in_row.pack(fill=tk.X, pady=(0, 8))

        ttk.Label(in_row, text="站號:").pack(side=tk.LEFT, padx=(2, 2))
        self.ent_new_no = ttk.Entry(in_row, width=5)
        self.ent_new_no.insert(0, str(len(self.stations) + 1))
        self.ent_new_no.pack(side=tk.LEFT, padx=(0, 10))

        ttk.Label(in_row, text="綁定 IP:").pack(side=tk.LEFT, padx=(2, 2))
        self.ent_new_ip = ttk.Entry(in_row, width=15)
        self.ent_new_ip.insert(0, f"192.168.3.{9 + len(self.stations) + 1}")
        self.ent_new_ip.pack(side=tk.LEFT, padx=(0, 10))

        ttk.Label(in_row, text="機種型號:").pack(side=tk.LEFT, padx=(2, 2))
        self.cmb_new_model = ttk.Combobox(in_row, values=list(DEVICE_CATALOG.keys()), width=18, state="readonly")
        self.cmb_new_model.set("NZ2GNCF1-32T")
        self.cmb_new_model.pack(side=tk.LEFT, padx=(0, 10))

        # 操作按鈕列
        btn_row = ttk.Frame(add_frame)
        btn_row.pack(fill=tk.X)

        self.btn_add_st = ttk.Button(btn_row, text="+ 新增站點", command=self._add_station_from_ui)
        self.btn_add_st.pack(side=tk.LEFT, padx=3)

        self.btn_edit_st = ttk.Button(btn_row, text="💾 儲存修改", command=self._edit_station_from_ui, state=tk.DISABLED)
        self.btn_edit_st.pack(side=tk.LEFT, padx=3)

        self.btn_del_st = ttk.Button(btn_row, text="🗑️ 刪除選取站", command=self._delete_station_from_ui, state=tk.DISABLED)
        self.btn_del_st.pack(side=tk.LEFT, padx=3)

        ttk.Button(btn_row, text="🔄 清空選取", command=self._clear_station_selection).pack(side=tk.LEFT, padx=3)
        ttk.Button(btn_row, text="🌐 帶入本機 IP", command=self._fill_local_ip).pack(side=tk.LEFT, padx=3)
        ttk.Button(btn_row, text="📋 複製 netsh 指令", command=self._copy_netsh_script).pack(side=tk.LEFT, padx=3)

        self.lbl_sel_hint = ttk.Label(btn_row, text="提示: 點擊下方表格任一站點可載入並執行修改或刪除", foreground="#666")
        self.lbl_sel_hint.pack(side=tk.RIGHT, padx=5)

        # 從站列表 Treeview
        cols = ("st", "ip", "model", "cat", "quality", "cycle", "jitter", "status")
        self.mgr_tree = ttk.Treeview(self.tab_manager, columns=cols, show="headings", height=8)
        self.mgr_tree.heading("st", text="TSN 站號")
        self.mgr_tree.heading("ip", text="綁定 IP 位址")
        self.mgr_tree.heading("model", text="機種型號")
        self.mgr_tree.heading("cat", text="類型")
        self.mgr_tree.heading("quality", text="連線品質")
        self.mgr_tree.heading("cycle", text="週期 (Cycle)")
        self.mgr_tree.heading("jitter", text="抖動 (Jitter)")
        self.mgr_tree.heading("status", text="狀態")

        self.mgr_tree.column("st", width=70)
        self.mgr_tree.column("ip", width=125)
        self.mgr_tree.column("model", width=135)
        self.mgr_tree.column("cat", width=65)
        self.mgr_tree.column("quality", width=95)
        self.mgr_tree.column("cycle", width=95)
        self.mgr_tree.column("jitter", width=85)
        self.mgr_tree.column("status", width=90)

        self.mgr_tree.pack(fill=tk.BOTH, expand=True)
        self.mgr_tree.bind("<<TreeviewSelect>>", self._on_station_selected)
        self._refresh_manager_tree()

    def _refresh_manager_tree(self):
        for item in self.mgr_tree.get_children():
            self.mgr_tree.delete(item)
        target_item = None
        for st_no, st in sorted(self.stations.items()):
            quality_str = st.quality if st.running else "⚪ 待機"
            cycle_str = f"{st.cycle_time_ms:.1f} ms" if st.running else "--"
            jitter_str = f"±{st.jitter_ms:.1f} ms" if st.running else "--"
            item_id = self.mgr_tree.insert(
                "",
                tk.END,
                values=(
                    f"#{st.station_no}",
                    st.ip_address,
                    st.model_name,
                    st.spec["category"],
                    quality_str,
                    cycle_str,
                    jitter_str,
                    "運行中 (RUN)" if st.running else "已就緒 (Ready)"
                )
            )
            if self.selected_edit_st_no == st.station_no:
                target_item = item_id
        if target_item:
            self.mgr_tree.selection_set(target_item)

    def _on_station_selected(self, event):
        selected = self.mgr_tree.selection()
        if not selected:
            return
        item = self.mgr_tree.item(selected[0])
        try:
            st_no = int(str(item["values"][0]).replace("#", "").strip())
        except (ValueError, IndexError):
            return

        if st_no in self.stations:
            st = self.stations[st_no]
            self.selected_edit_st_no = st_no
            self.ent_new_no.delete(0, tk.END)
            self.ent_new_no.insert(0, str(st.station_no))
            self.ent_new_ip.delete(0, tk.END)
            self.ent_new_ip.insert(0, st.ip_address)
            self.cmb_new_model.set(st.model_name)
            self.btn_edit_st.config(state=tk.NORMAL)
            self.btn_del_st.config(state=tk.NORMAL)
            self.lbl_sel_hint.config(text=f"選取中: 從站 #{st_no} ({st.model_name})，可進行修改或刪除", foreground="#0052cc")

    def _clear_station_selection(self):
        self.mgr_tree.selection_remove(self.mgr_tree.selection())
        self.selected_edit_st_no = None
        self.btn_edit_st.config(state=tk.DISABLED)
        self.btn_del_st.config(state=tk.DISABLED)
        self.lbl_sel_hint.config(text="提示: 點擊下方表格任一站點可載入並執行修改或刪除", foreground="#666")

        next_no = max(self.stations.keys(), default=0) + 1
        self.ent_new_no.delete(0, tk.END)
        self.ent_new_no.insert(0, str(next_no))
        self.ent_new_ip.delete(0, tk.END)
        self.ent_new_ip.insert(0, f"192.168.3.{9 + next_no}")

    def _add_station_from_ui(self):
        try:
            st_no = int(self.ent_new_no.get())
            ip = self.ent_new_ip.get().strip()
            model = self.cmb_new_model.get()
            if st_no < 1 or st_no > 254:
                messagebox.showerror("錯誤", "站號必須介於 1 到 254 之間！")
                return
            if st_no in self.stations:
                messagebox.showerror("錯誤", f"站號 #{st_no} 已存在！")
                return
            if any(s.ip_address == ip for s in self.stations.values()):
                messagebox.showerror("錯誤", f"IP 位址 {ip} 已經被其他站點使用！")
                return

            self.add_station(st_no, ip, model)
            st = self.stations[st_no]

            # 若模擬器已經在執行中，自動納管新站點開始監聽
            if self.is_running:
                if self.bind_all_interfaces.get():
                    st.running = True
                else:
                    t = threading.Thread(target=self._worker_loop, args=(st,), daemon=True)
                    t.start()
                    self.threads.append(t)

            self._refresh_manager_tree()
            self.st_combo.config(values=list(self.stations.keys()))
            self._clear_station_selection()
            messagebox.showinfo("成功", f"成功新增從站 #{st_no} ({model})！")
        except ValueError:
            messagebox.showerror("錯誤", "請輸入合法的整數站號！")

    def _edit_station_from_ui(self):
        if self.selected_edit_st_no is None or self.selected_edit_st_no not in self.stations:
            messagebox.showwarning("提示", "請先在下方表格點選欲修改的從站！")
            return
        old_no = self.selected_edit_st_no
        st = self.stations[old_no]
        try:
            new_no = int(self.ent_new_no.get())
            new_ip = self.ent_new_ip.get().strip()
            new_model = self.cmb_new_model.get()

            if new_no < 1 or new_no > 254:
                messagebox.showerror("錯誤", "站號必須介於 1 到 254 之間！")
                return
            if new_no != old_no and new_no in self.stations:
                messagebox.showerror("錯誤", f"站號 #{new_no} 已經被其他站點使用！")
                return
            if any(s.station_no != old_no and s.ip_address == new_ip for s in self.stations.values()):
                messagebox.showerror("錯誤", f"IP 位址 {new_ip} 已經被其他站點使用！")
                return

            # 在獨立 IP 綁定模式下，若 IP 或站號變更則重啟該站 Socket
            if not self.bind_all_interfaces.get() and st.running and (st.ip_address != new_ip or st.station_no != new_no):
                if st.sock:
                    try:
                        st.sock.close()
                    except Exception:
                        pass
                st.running = False

            if new_no != old_no:
                del self.stations[old_no]
                st.station_no = new_no
                self.stations[new_no] = st
                self.selected_edit_st_no = new_no
                if self.selected_st_no.get() == old_no:
                    self.selected_st_no.set(new_no)

            st.ip_address = new_ip
            if st.model_name != new_model:
                st.init_buffers_for_model(new_model)

            # 確保運行中狀態不中斷
            if self.is_running:
                if self.bind_all_interfaces.get():
                    st.running = True
                elif not st.running:
                    t = threading.Thread(target=self._worker_loop, args=(st,), daemon=True)
                    t.start()
                    self.threads.append(t)

            self._refresh_manager_tree()
            self._refresh_workbench()
            self.st_combo.config(values=list(self.stations.keys()))
            messagebox.showinfo("修改成功", f"從站 #{new_no} 資料已成功更新！")
        except ValueError:
            messagebox.showerror("錯誤", "請輸入合法的整數站號！")

    def _delete_station_from_ui(self):
        if self.selected_edit_st_no is None or self.selected_edit_st_no not in self.stations:
            messagebox.showwarning("提示", "請先在下方表格點選欲刪除的從站！")
            return
        st_no = self.selected_edit_st_no
        st = self.stations[st_no]
        if messagebox.askyesno(
            "確認刪除",
            f"確定要刪除從站 #{st_no} (IP: {st.ip_address}, 機種: {st.model_name}) 嗎？\n此動作將停止該站監聽並從模擬佇列中移除。"
        ):
            st.running = False
            if st.sock:
                try:
                    st.sock.close()
                except Exception:
                    pass
            del self.stations[st_no]

            if self.selected_st_no.get() == st_no:
                rem = list(self.stations.keys())
                self.selected_st_no.set(rem[0] if rem else 1)

            self._clear_station_selection()
            self.st_combo.config(values=list(self.stations.keys()))
            self._refresh_manager_tree()
            self._refresh_workbench()
            messagebox.showinfo("已刪除", f"已成功移除從站 #{st_no}！")

    def _build_status_bar(self):
        self.status_bar = ttk.Label(
            self.root,
            text=" 就緒。預設開啟 0.0.0.0 萬用監聽模式，點擊右上角「啟動全部從站監聽」即可與 PLC 通訊。",
            relief=tk.SUNKEN,
            font=("Microsoft JhengHei UI", 9)
        )
        self.status_bar.pack(fill=tk.X, side=tk.BOTTOM)

    # --------------------------------------------------------------------------
    # 網路診斷與 Windows WinError 10049 處理工具
    # --------------------------------------------------------------------------
    def get_detected_local_ips(self) -> List[str]:
        """偵測本機目前所有的非 Loopback IPv4 網卡位址"""
        ips = set()
        try:
            hostname = socket.gethostname()
            for ip in socket.gethostbyname_ex(hostname)[2]:
                if not ip.startswith("127."):
                    ips.add(ip)
        except Exception:
            pass
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ips.add(s.getsockname()[0])
            s.close()
        except Exception:
            pass
        return sorted(list(ips))

    def _fill_local_ip(self):
        ips = self.get_detected_local_ips()
        if ips:
            self.ent_new_ip.delete(0, tk.END)
            self.ent_new_ip.insert(0, ips[0])
            messagebox.showinfo("帶入本機 IP", f"已成功將 IP 欄位填入為偵測到的本機 IP:\n{ips[0]}")
        else:
            messagebox.showwarning("提示", "未偵測到實體網卡 IP，請手動輸入。")

    def _build_netsh_script_text(self) -> str:
        cmd_lines = ["@echo off", "chcp 65001 >nul", "echo 正在為 Windows 乙太網路新增 CC-Link IE TSN 次要 IP..."]
        for st in self.stations.values():
            cmd_lines.append(f'netsh interface ipv4 add address "乙太網路" {st.ip_address} 255.255.255.0')
        cmd_lines.append("echo 新增完成！請按任意鍵退出。")
        cmd_lines.append("pause")
        return "\n".join(cmd_lines)

    def _copy_netsh_script(self):
        script = self._build_netsh_script_text()
        self.root.clipboard_clear()
        self.root.clipboard_append(script)
        messagebox.showinfo(
            "已複製 netsh 指令",
            "已複製 Windows netsh 批次指令至剪貼簿！\n請打開記事本存為 add_ip.bat，並『以系統管理員身分執行』即可。"
        )

    def _show_network_diagnostics(self):
        ips = self.get_detected_local_ips()
        ip_list_str = "\n".join(f"  • {ip}" for ip in ips) if ips else "  (未偵測到實體網卡 IP)"
        netsh_script = self._build_netsh_script_text()

        diag_win = tk.Toplevel(self.root)
        diag_win.title("Windows 網路卡與 IP 位址診斷指引 (WinError 10049 排查)")
        diag_win.geometry("640x500")
        diag_win.transient(self.root)

        txt = (
            "【WinError 10049 核心原因與排查說明】\n"
            "--------------------------------------------------\n"
            "在 Windows (Winsock) 中，呼叫 socket.bind((IP, Port)) 時，\n"
            "該 IP 位址必須「已存在於本機電腦的某一張網路卡」上。\n\n"
            f"您目前電腦已配發的本機實體 IP：\n{ip_list_str}\n\n"
            "💡 兩種解決方式：\n"
            "方式一（最簡便，免設次要 IP）：\n"
            "   勾選頂部「0.0.0.0 萬用監聽模式」（預設啟用）。\n"
            "   單網卡直接監聽所有網路介面，依封包內 station_no 自動分派處理！\n\n"
            "方式二（標準實體多站獨立 IP 模式）：\n"
            "   以「系統管理員身分」開啟 CMD 命令提示字元，執行下方 netsh 指令："
        )

        f = ttk.Frame(diag_win, padding=12)
        f.pack(fill=tk.BOTH, expand=True)

        ttk.Label(f, text=txt, justify=tk.LEFT, font=("Microsoft JhengHei UI", 9)).pack(fill=tk.X)

        txt_cmd = tk.Text(f, height=6, font=("Consolas", 9), bg="#1e1e1e", fg="#4ec9b0")
        txt_cmd.pack(fill=tk.BOTH, expand=True, pady=6)
        txt_cmd.insert(tk.END, netsh_script)

        btn_box = ttk.Frame(f)
        btn_box.pack(fill=tk.X, pady=(5, 0))

        def copy_cmd():
            self.root.clipboard_clear()
            self.root.clipboard_append(netsh_script)
            messagebox.showinfo("已複製", "已複製 netsh 指令至剪貼簿！請以系統管理員身分貼至 CMD 執行。")

        ttk.Button(btn_box, text="📋 複製 netsh 指令", command=copy_cmd).pack(side=tk.LEFT, padx=5)
        ttk.Button(btn_box, text="關閉", command=diag_win.destroy).pack(side=tk.RIGHT, padx=5)

    def _handle_winerror_10049(self, st_no: int, ip_addr: str):
        """當獨立 IP 綁定觸發 WinError 10049 時，彈出互動式自動修復精靈"""
        ips = self.get_detected_local_ips()
        ip_list_str = ", ".join(ips) if ips else "未偵測到實體網卡 IP"

        msg = (
            "【WinError 10049 內容所要求的位址不正確】\n\n"
            f"● 錯誤目標：從站 #{st_no} 嘗試綁定 IP: {ip_addr}\n"
            "● 原因剖析：Windows 網路介面卡上並不存在該 IP 位址。\n"
            f"（您電腦目前偵測到的本機 IP 為: {ip_list_str}）\n\n"
            "💡 立即修復建議：\n"
            "是否立即為您切換為「0.0.0.0 萬用監聽模式」？\n"
            "（勾選後單一網卡即可監聽並回應所有由 PLC 發往本機之 CC-Link IE TSN 封包，免去設定次要 IP 的繁瑣步驟）"
        )
        if messagebox.askyesno("WinError 10049 自動修復精靈", msg):
            self.bind_all_interfaces.set(True)
            self.stop_simulator()
            self.root.after(200, self.start_simulator)

    # --------------------------------------------------------------------------
    # 核心網路通訊執行緒與事件分派
    # --------------------------------------------------------------------------
    def add_station(self, st_no: int, ip: str, model: str):
        self.stations[st_no] = DeviceStation(station_no=st_no, ip_address=ip, model_name=model)

    def toggle_simulator(self):
        if not self.is_running:
            self.start_simulator()
        else:
            self.stop_simulator()

    def start_simulator(self):
        self.is_running = True
        self.btn_toggle_all.config(text="⏹ 停止全部從站", bg="#dc3545")

        if self.bind_all_interfaces.get():
            self.status_bar.config(text=" [0.0.0.0 萬用監聽模式] 正在監聽 UDP 61450... 任何指向本機之 TSN 循環幀均可正常接收。")
            t = threading.Thread(target=self._shared_worker_loop, daemon=True)
            t.start()
            self.threads.append(t)
        else:
            self.status_bar.config(text=" [獨立 IP 綁定模式] 正在監聽各站專屬 IP UDP 61450... 等待 PLC 主站握手連接。")
            for st in self.stations.values():
                t = threading.Thread(target=self._worker_loop, args=(st,), daemon=True)
                t.start()
                self.threads.append(t)

        self._refresh_manager_tree()

    def stop_simulator(self):
        self.is_running = False
        self.btn_toggle_all.config(text="▶ 啟動全部從站監聽", bg="#28a745")
        if hasattr(self, "shared_sock") and self.shared_sock:
            try:
                self.shared_sock.close()
            except Exception:
                pass
            self.shared_sock = None

        for st in self.stations.values():
            st.running = False
            if st.sock:
                try:
                    st.sock.close()
                except Exception:
                    pass
        self.status_bar.config(text=" 已停止所有從站。")
        self._refresh_manager_tree()

    def _shared_worker_loop(self):
        """萬用監聽模式 (0.0.0.0:61450)：單一 Socket 監聽所有網路卡，依封包內 station_no 自動分派處理"""
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.shared_sock = sock

        try:
            sock.bind(("0.0.0.0", 61450))
            for st in self.stations.values():
                st.running = True
        except Exception as e:
            self.ui_queue.put(("LOG", f"0.0.0.0 萬用監聽綁定失敗: {e}"))
            return

        sock.settimeout(0.5)
        while self.is_running:
            try:
                data, master_addr = sock.recvfrom(2048)
                if len(data) < 10:
                    continue

                # CC-Link IE TSN Header 第 8 Byte 為站號 (Station No)
                target_st_no = data[8]
                target_st = self.stations.get(target_st_no)

                # 若找不到對應站號，預設回退至當前 UI 選取站點以利單機測試
                if target_st is None or not target_st.running:
                    cur_sel = self.selected_st_no.get()
                    target_st = self.stations.get(cur_sel)
                    if target_st is None or not target_st.running:
                        target_st = next((s for s in self.stations.values() if s.running), None)

                if target_st and target_st.running:
                    target_st.record_packet_arrival()
                    if self.sniffing_active:
                        self.ui_queue.put(("PACKET", ("RX", target_st.station_no, master_addr[0], data)))

                    target_st.unpack_cyclic_command(data)
                    resp = target_st.pack_cyclic_response()
                    sock.sendto(resp, master_addr)

                    if self.sniffing_active:
                        self.ui_queue.put(("PACKET", ("TX", target_st.station_no, master_addr[0], resp)))

                    self.ui_queue.put(("UPDATE_IO", target_st.station_no))

            except socket.timeout:
                continue
            except Exception:
                break

    def _worker_loop(self, st: DeviceStation):
        """獨立 IP 綁定模式：為單一從站開啟專屬 IP:61450 UDP Socket 監聽"""
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        st.sock = sock

        try:
            sock.bind((st.ip_address, st.udp_port))
            st.running = True
        except OSError as e:
            err_code = getattr(e, 'winerror', None) or getattr(e, 'errno', None)
            if err_code == 10049 or '10049' in str(e):
                self.ui_queue.put(("WINERROR_10049", (st.station_no, st.ip_address)))
            else:
                self.ui_queue.put(("LOG", f"站號 #{st.station_no} ({st.ip_address}) 綁定失敗: {e}"))
            return
        except Exception as e:
            self.ui_queue.put(("LOG", f"站號 #{st.station_no} ({st.ip_address}) 綁定失敗: {e}"))
            return

        sock.settimeout(0.5)
        while self.is_running and st.running:
            try:
                data, master_addr = sock.recvfrom(2048)
                st.record_packet_arrival()

                if self.sniffing_active:
                    self.ui_queue.put(("PACKET", ("RX", st.station_no, master_addr[0], data)))

                st.unpack_cyclic_command(data)
                resp = st.pack_cyclic_response()
                sock.sendto(resp, master_addr)

                if self.sniffing_active:
                    self.ui_queue.put(("PACKET", ("TX", st.station_no, master_addr[0], resp)))

                self.ui_queue.put(("UPDATE_IO", st.station_no))

            except socket.timeout:
                continue
            except Exception:
                break

    def _simulate_master_packet(self):
        """無實體 PLC 時用於單機自我驗證之模擬封包發送按鈕"""
        st_no = self.selected_st_no.get()
        if st_no not in self.stations:
            return
        st = self.stations[st_no]
        st.record_packet_arrival()

        seq = (st.sequence_no + 1) & 0xFFFF
        hdr = struct.pack("!HIHBb", 0xCC1E, st.spec["model_code"], seq, st.station_no, 0x00)
        sim_data = hdr + bytes(len(st.ry_buffer)) + bytes(len(st.rww_buffer))

        self.ui_queue.put(("PACKET", ("RX", st.station_no, "192.168.3.250", sim_data)))
        st.unpack_cyclic_command(sim_data)
        resp = st.pack_cyclic_response()
        self.ui_queue.put(("PACKET", ("TX", st.station_no, "192.168.3.250", resp)))
        self.ui_queue.put(("UPDATE_IO", st.station_no))
        self._refresh_manager_tree()

    def _process_ui_queue(self):
        """在主執行緒定時消費 UI 事件佇列，避免多執行緒直接操作 Tkinter 元件引發崩潰"""
        try:
            while True:
                msg_type, payload = self.ui_queue.get_nowait()
                if msg_type == "PACKET":
                    direction, st_no, master_ip, data = payload
                    ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
                    hex_str = " ".join(f"{b:02X}" for b in data)
                    seq = (data[6] << 8) | data[7] if len(data) >= 8 else 0

                    self.tree.insert(
                        "",
                        0,
                        values=(
                            ts,
                            "◀ PLC->從站" if direction == "RX" else "▶ 從站->PLC",
                            f"#{st_no}",
                            master_ip,
                            f"0x{seq:04X}",
                            f"{len(data)}B",
                            hex_str
                        )
                    )
                    children = self.tree.get_children()
                    if len(children) > 50:
                        self.tree.delete(children[-1])

                elif msg_type == "UPDATE_IO":
                    updated_st = payload
                    if updated_st == self.selected_st_no.get() and updated_st in self.stations:
                        st = self.stations[updated_st]
                        if hasattr(self, "ry_labels") and st.spec["category"] in ("DO", "DIO"):
                            pts = 16 if st.spec["category"] == "DIO" else 32
                            offset = 16 if st.spec["category"] == "DIO" else 0
                            for i in range(min(len(self.ry_labels), pts)):
                                val = st.get_digital_output(i + offset)
                                self.ry_labels[i].config(
                                    bg="#007bff" if val else "#e0e0e0",
                                    fg="white" if val else "#666",
                                    text=f"Y{i+offset:X}\n{'1' if val else '0'}"
                                )
                        if hasattr(self, "analog_lbls") and st.spec["category"] == "AO":
                            for ch in range(1, 5):
                                val = st.get_analog_output(ch)
                                self.analog_lbls[ch - 1].config(text=f"{val}\n(~{(val/16000*10):.2f} V)")

                elif msg_type == "WINERROR_10049":
                    st_no, ip_addr = payload
                    self._handle_winerror_10049(st_no, ip_addr)

                elif msg_type == "LOG":
                    messagebox.showwarning("通訊警告", payload)

        except queue.Empty:
            pass

        # 運行中每秒定時更新從站列表之 Cycle Time 與 Jitter 指標
        now = time.time()
        if now - getattr(self, "_last_metrics_refresh", 0) >= 1.0:
            self._last_metrics_refresh = now
            if self.is_running:
                self._refresh_manager_tree()

        self.root.after(50, self._process_ui_queue)

    def _on_close(self):
        self.stop_simulator()
        self.root.destroy()


# ==============================================================================
# 4. 主程式啟動入口
# ==============================================================================
if __name__ == "__main__":
    root = tk.Tk()
    app = CCLinkTSNSimulatorGUI(root)
    root.mainloop()
