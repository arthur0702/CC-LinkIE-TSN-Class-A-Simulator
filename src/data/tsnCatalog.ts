/**
 * CC-Link IE TSN Class A 機種規格目錄與封包產生器
 * ================================================
 * 依據三菱電機原廠 CSP+ XML 描述檔解析彙整，包含：
 * 1. 支援機種清單 (6 款數位與類比模組)
 * 2. 模擬站點與封包監控介面之 TypeScript 型別定義
 * 3. CC-Link IE TSN Class A 循環封包組裝函式
 * 4. 動態同步之 Python CLI 多站腳本產生器
 */

/** 支援之 CC-Link IE TSN 遠端設備模組規格介面 */
export interface DeviceSpec {
  id: string;
  model: string;
  name: string;
  category: 'DO' | 'DI' | 'DIO' | 'AI' | 'AO';
  vendorCode: number;
  modelCode: number;
  modelCodeHex: string;
  deviceTypeId: number;
  deviceTypeDetail: string;
  pointsDesc: string;
  xmlFile: string;
  rxBitsCount: number;
  ryBitsCount: number;
  rwrWordsCount: number;
  rwwWordsCount: number;
  /** Ready 旗標位置：數位模組位於 RWr0.b11；類比模組位於 RXB (bit 11) */
  readyLocation: 'RWr0.b11' | 'RXB';
  /** 錯誤碼位置：數位模組位於 RWr1；類比模組異常旗標在 RXA、錯誤碼在 RWr0 */
  errorLocation: 'RWr1' | 'RXA';
}

/** 單一模擬從站之配置與即時連線品質狀態 */
export interface ConfiguredStation {
  id: string;
  stationNo: number;
  ipAddress: string;
  modelId: string;
  enabled: boolean;
  port: number;
  cycleTimeMs: number;
  jitterMs: number;
  quality: 'excellent' | 'fair' | 'poor' | 'offline';
  packetCount: number;
  lastPacketTime?: number;
  historyIntervals?: number[];
}

/** 封包監控面板 (Packet Sniffer) 單筆封包結構 */
export interface SnifferPacket {
  id: string;
  timestamp: string;
  timestampMs: number;
  /** RX = 主站寫入從站之指令；TX = 從站回覆主站之狀態 */
  direction: 'RX' | 'TX';
  stationNo: number;
  model: string;
  srcIp: string;
  srcPort: number;
  dstIp: string;
  dstPort: number;
  seqNo: number;
  lengthBytes: number;
  rawHex: string[];
  decoded: {
    magic: string;
    modelCode: string;
    seqNo: number;
    stationNo: number;
    statusDesc: string;
    payloadType: string;
    ryOrRxSummary: string;
    rwwOrRwrSummary: string;
  };
}

/** 已解析之 6 款三菱原廠 CSP+ 機種規格目錄 */
export const SUPPORTED_DEVICES: DeviceSpec[] = [
  {
    id: 'NZ2GNCF1-32T',
    model: 'NZ2GNCF1-32T',
    name: '32點電晶體輸出模組 (40-Pin 插針型)',
    category: 'DO',
    vendorCode: 0x0000,
    modelCode: 1610547602,
    modelCodeHex: '0x60010192',
    deviceTypeId: 0x0003,
    deviceTypeDetail: 'Transistor Output (Sink, 0.1A/點)',
    pointsDesc: '32 Outputs (Y0~Y1F)',
    xmlFile: '0x0000_NZ2GNCF1-32T_1_en_53ef3efd.xml',
    rxBitsCount: 32,
    ryBitsCount: 32,
    rwrWordsCount: 4,
    rwwWordsCount: 4,
    readyLocation: 'RWr0.b11',
    errorLocation: 'RWr1',
  },
  {
    id: 'NZ2GN2S1-32T',
    model: 'NZ2GN2S1-32T',
    name: '32點電晶體輸出模組 (彈簧夾端子台型)',
    category: 'DO',
    vendorCode: 0x0000,
    modelCode: 1610547346,
    modelCodeHex: '0x60010092',
    deviceTypeId: 0x0003,
    deviceTypeDetail: 'Transistor Output (Sink, 0.5A/點)',
    pointsDesc: '32 Outputs (Y0~Y1F)',
    xmlFile: '0x0000_NZ2GN2S1-32T_1_en_705dbb67.xml',
    rxBitsCount: 32,
    ryBitsCount: 32,
    rwrWordsCount: 4,
    rwwWordsCount: 4,
    readyLocation: 'RWr0.b11',
    errorLocation: 'RWr1',
  },
  {
    id: 'NZ2GN2S1-32D',
    model: 'NZ2GN2S1-32D',
    name: '32點數位DC輸入模組 (彈簧夾端子台型)',
    category: 'DI',
    vendorCode: 0x0000,
    modelCode: 1610549392,
    modelCodeHex: '0x60010890',
    deviceTypeId: 0x0003,
    deviceTypeDetail: 'DC Input (24VDC, 正負共用)',
    pointsDesc: '32 Inputs (X0~X1F)',
    xmlFile: '0x0000_NZ2GN2S1-32D_1_en_764c50a4.xml',
    rxBitsCount: 32,
    ryBitsCount: 32,
    rwrWordsCount: 4,
    rwwWordsCount: 4,
    readyLocation: 'RWr0.b11',
    errorLocation: 'RWr1',
  },
  {
    id: 'NZ2GN2S1-32DT',
    model: 'NZ2GN2S1-32DT',
    name: '16點輸入 / 16點輸出 複合模組',
    category: 'DIO',
    vendorCode: 0x0000,
    modelCode: 1610549396,
    modelCodeHex: '0x60010894',
    deviceTypeId: 0x0003,
    deviceTypeDetail: 'I/O Combined (16 In + 16 Out)',
    pointsDesc: '16 Inputs (X0~XF) + 16 Outputs (Y10~Y1F)',
    xmlFile: '0x0000_NZ2GN2S1-32DT_1_en_888dbc7b.xml',
    rxBitsCount: 32,
    ryBitsCount: 32,
    rwrWordsCount: 4,
    rwwWordsCount: 4,
    readyLocation: 'RWr0.b11',
    errorLocation: 'RWr1',
  },
  {
    id: 'NZ2GN2S-60AD4',
    model: 'NZ2GN2S-60AD4',
    name: '4通道高精度類比輸入模組 (A/D)',
    category: 'AI',
    vendorCode: 0x0000,
    modelCode: 1342177282,
    modelCodeHex: '0x50000002',
    deviceTypeId: 0x0004,
    deviceTypeDetail: 'Analog Input (-10~+10V / 0~20mA)',
    pointsDesc: '4 Channels Input (RWr2~RWr5)',
    xmlFile: '0x0000_NZ2GN2S-60AD4_1_en_eee66392.xml',
    rxBitsCount: 32,
    ryBitsCount: 32,
    rwrWordsCount: 16,
    rwwWordsCount: 16,
    readyLocation: 'RXB',
    errorLocation: 'RXA',
  },
  {
    id: 'NZ2GN2S-60DA4',
    model: 'NZ2GN2S-60DA4',
    name: '4通道高精度類比輸出模組 (D/A)',
    category: 'AO',
    vendorCode: 0x0000,
    modelCode: 1342177284,
    modelCodeHex: '0x50000004',
    deviceTypeId: 0x0004,
    deviceTypeDetail: 'Analog Output (-10~+10V / 0~20mA)',
    pointsDesc: '4 Channels Output (RWw2~RWw5)',
    xmlFile: '0x0000_NZ2GN2S-60DA4_1_en_81245328.xml',
    rxBitsCount: 32,
    ryBitsCount: 32,
    rwrWordsCount: 32,
    rwwWordsCount: 32,
    readyLocation: 'RXB',
    errorLocation: 'RXA',
  },
];

/** 格式化目前時間為 HH:MM:SS.mmm 字串 */
export function getFormattedTime(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

/** 將數值轉為兩位大寫十六進位字串 */
export function toHex2(val: number): string {
  return (val & 0xff).toString(16).padStart(2, '0').toUpperCase();
}

/** 將 32 位元布林陣列壓縮為 4 個 Byte 陣列（LSB 優先） */
export function bitsToBytes(bits: boolean[]): number[] {
  const bytes = [0, 0, 0, 0];
  for (let i = 0; i < 32; i++) {
    if (bits[i]) {
      bytes[Math.floor(i / 8)] |= 1 << (i % 8);
    }
  }
  return bytes;
}

/** 依據站點與機種規格建構模擬 CC-Link IE TSN Class A UDP 封包 */
export function createSimulatedPacket(
  direction: 'RX' | 'TX',
  station: ConfiguredStation,
  seq: number,
  masterIp = '192.168.3.250'
): SnifferPacket {
  const dev = SUPPORTED_DEVICES.find((d) => d.id === station.modelId) || SUPPORTED_DEVICES[0];
  const isMasterToSlave = direction === 'RX';

  // 10-Byte Header (Big-Endian): Magic(2B) + ModelCode(4B) + Seq(2B) + StationNo(1B) + Status(1B)
  const mc = dev.modelCode;
  const headerHex = [
    'CC',
    '1E',
    toHex2((mc >>> 24) & 0xff),
    toHex2((mc >>> 16) & 0xff),
    toHex2((mc >>> 8) & 0xff),
    toHex2(mc & 0xff),
    toHex2((seq >> 8) & 0xff),
    toHex2(seq & 0xff),
    toHex2(station.stationNo),
    '00',
  ];

  let payloadHex: string[] = [];
  let ryOrRxSummary = '';
  let rwwOrRwrSummary = '';

  if (isMasterToSlave) {
    // 主站下發：RY + RWw
    if (dev.category === 'DO' || dev.category === 'DIO') {
      payloadHex = ['01', '00', '00', '00'];
      ryOrRxSummary = 'RY: Y0=ON (0x00000001)';
    } else {
      payloadHex = ['00', '00', '00', '00'];
      ryOrRxSummary = 'RY: 0x00000000';
    }

    if (dev.category === 'AO') {
      payloadHex = payloadHex.concat([
        '00', '00', '00', '00', // RWw0, RWw1
        'D0', '07', '70', '17', // CH1=2000, CH2=6000
        '10', '27', 'B0', '36', // CH3=10000, CH4=14000
      ]);
      rwwOrRwrSummary = 'RWw: CH1=2000, CH2=6000, CH3=10000, CH4=14000';
    } else {
      payloadHex = payloadHex.concat(['00', '00', '00', '00', '00', '00', '00', '00']);
      rwwOrRwrSummary = 'RWw: 4 Words (0x0000)';
    }
  } else {
    // 從站回傳：RX + RWr
    if (dev.readyLocation === 'RXB') {
      // 類比模組：RXB (bit 11) + RX9 (bit 9) = 0x0A00 -> Byte1 = 0x0A
      payloadHex = ['00', '0A', '00', '00'];
      ryOrRxSummary = 'RX: Ready=1 (RXB), InitComp=1 (RX9)';
      payloadHex = payloadHex.concat([
        '00', '00', '00', '00', // RWr0, RWr1
        'A0', '0F', '40', '1F', // CH1=4000, CH2=8000
        'E0', '2E', '80', '3E', // CH3=12000, CH4=16000
      ]);
      rwwOrRwrSummary = 'RWr: Error=0, CH1=4000, CH2=8000, CH3=12000, CH4=16000';
    } else {
      // 數位模組：X0=1, X2=1 -> 0x05；Ready 位於 RWr0.b11 -> 0x0A00
      payloadHex = ['05', '00', '00', '00'];
      ryOrRxSummary = 'RX: X0=ON, X2=ON (0x00000005)';
      payloadHex = payloadHex.concat([
        '00', '0A', // RWr0 = 0x0A00 (Ready ON)
        '00', '00', // RWr1 = 0x0000 (無錯誤)
        '00', '0B', // RWr2 = 0x0B00
        '00', '00', // RWr3 = 0x0000
      ]);
      rwwOrRwrSummary = 'RWr: RWr0=0x0A00 (Ready ON), RWr1=0 (OK)';
    }
  }

  const rawHex = [...headerHex, ...payloadHex];

  return {
    id: 'pkt-' + Math.random().toString(36).substring(2, 9),
    timestamp: getFormattedTime(),
    timestampMs: Date.now(),
    direction,
    stationNo: station.stationNo,
    model: dev.model,
    srcIp: isMasterToSlave ? masterIp : station.ipAddress,
    srcPort: station.port,
    dstIp: isMasterToSlave ? station.ipAddress : masterIp,
    dstPort: station.port,
    seqNo: seq,
    lengthBytes: rawHex.length,
    rawHex,
    decoded: {
      magic: '0xCC1E (CC-Link IE TSN Cyclic)',
      modelCode: `${dev.modelCodeHex} (${dev.model})`,
      seqNo: seq,
      stationNo: station.stationNo,
      statusDesc: '0x00 (Data Link Active / OK)',
      payloadType: isMasterToSlave ? 'Cyclic Command (RY + RWw)' : 'Cyclic Response (RX + RWr)',
      ryOrRxSummary,
      rwwOrRwrSummary,
    },
  };
}

/** 依據啟用站點列表動態組裝無介面 (CLI) Python 多站模擬器完整程式碼 */
export function buildCliSimulatorScript(activeStations: ConfiguredStation[]): string {
  const pythonSetupLines =
    activeStations.length > 0
      ? activeStations
          .map(
            (s) =>
              `    mgr.add_station(station_no=${s.stationNo}, ip_address="${s.ipAddress}", model_name="${s.modelId}")`
          )
          .join('\n')
      : '    # 目前無啟用站點，請先於管理列表新增或啟用';

  return `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CC-Link IE TSN Class A 多機種、多站核心後台模擬器 (CLI)
======================================================
由網頁管理面板即時配置 (${activeStations.length} 個啟用站點)
支援 0.0.0.0 萬用監聽模式（免設定次要 IP）與獨立 IP 綁定模式。
"""

import datetime
import socket
import struct
import threading
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

# ==========================================================
# 1. 支援機種規格目錄 (Device Models Catalog)
# ==========================================================
DEVICE_CATALOG = {
    "NZ2GNCF1-32T":  {"model": "NZ2GNCF1-32T",  "model_code": 0x60010192, "rx_bits": 32, "ry_bits": 32, "rwr_words": 4,  "rww_words": 4,  "ready_in_rwr": True},
    "NZ2GN2S1-32T":  {"model": "NZ2GN2S1-32T",  "model_code": 0x60010092, "rx_bits": 32, "ry_bits": 32, "rwr_words": 4,  "rww_words": 4,  "ready_in_rwr": True},
    "NZ2GN2S1-32D":  {"model": "NZ2GN2S1-32D",  "model_code": 0x60010890, "rx_bits": 32, "ry_bits": 32, "rwr_words": 4,  "rww_words": 4,  "ready_in_rwr": True},
    "NZ2GN2S1-32DT": {"model": "NZ2GN2S1-32DT", "model_code": 0x60010894, "rx_bits": 32, "ry_bits": 32, "rwr_words": 4,  "rww_words": 4,  "ready_in_rwr": True},
    "NZ2GN2S-60AD4": {"model": "NZ2GN2S-60AD4", "model_code": 0x50000002, "rx_bits": 32, "ry_bits": 32, "rwr_words": 16, "rww_words": 16, "ready_in_rwr": False},
    "NZ2GN2S-60DA4": {"model": "NZ2GN2S-60DA4", "model_code": 0x50000004, "rx_bits": 32, "ry_bits": 32, "rwr_words": 32, "rww_words": 32, "ready_in_rwr": False},
}

# ==========================================================
# 2. 封包監控紀錄格式化工具
# ==========================================================
def log_packet_hex(direction: str, ip: str, port: int, data: bytes, station_no: int, model: str):
    """格式化輸出 UDP 原始封包時間戳與 Hex 內容"""
    ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
    hex_str = " ".join(f"{b:02X}" for b in data)
    arrow = "◀ [RX 接收]" if direction == "RX" else "▶ [TX 回應]"
    print(f"[{ts}] {arrow} 站號 #{station_no:02d} ({model}) | {ip}:{port} ({len(data)}B)")
    print(f"      HEX: {hex_str}")

# ==========================================================
# 3. 單站設備實體 (DeviceStation)
# ==========================================================
@dataclass
class DeviceStation:
    station_no: int
    ip_address: str
    model_name: str = "NZ2GNCF1-32T"
    rx_buffer: bytearray = field(init=False)
    ry_buffer: bytearray = field(init=False)
    rwr_buffer: bytearray = field(init=False)
    rww_buffer: bytearray = field(init=False)
    remote_ready: bool = True
    condition_set_comp: bool = True
    error_code: int = 0x0000
    sequence_no: int = 0

    def __post_init__(self):
        self.spec = DEVICE_CATALOG.get(self.model_name, DEVICE_CATALOG["NZ2GNCF1-32T"])
        self.rx_buffer = bytearray(self.spec["rx_bits"] // 8)
        self.ry_buffer = bytearray(self.spec["ry_bits"] // 8)
        self.rwr_buffer = bytearray(self.spec["rwr_words"] * 2)
        self.rww_buffer = bytearray(self.spec["rww_words"] * 2)
        self.update_buffers()

    def update_buffers(self):
        """依據機種特性寫入 Ready 與狀態旗標（數位: RWr0.b11；類比: RXB）"""
        if self.spec["ready_in_rwr"]:
            rwr0 = (1 << 9 if self.condition_set_comp else 0) | (1 << 11 if self.remote_ready and self.error_code == 0 else 0)
            struct.pack_into("<H", self.rwr_buffer, 0, rwr0)
            struct.pack_into("<H", self.rwr_buffer, 2, self.error_code)
            struct.pack_into("<H", self.rwr_buffer, 4, 0x0B00)
        else:
            rx_val = struct.unpack_from("<I", self.rx_buffer, 0)[0] & ~((1 << 9) | (1 << 10) | (1 << 11))
            if self.condition_set_comp: rx_val |= (1 << 9)
            if self.error_code != 0:    rx_val |= (1 << 10)
            if self.remote_ready and self.error_code == 0: rx_val |= (1 << 11)
            struct.pack_into("<I", self.rx_buffer, 0, rx_val)
            struct.pack_into("<H", self.rwr_buffer, 0, self.error_code)

    def pack_cyclic_response(self) -> bytes:
        self.update_buffers()
        self.sequence_no = (self.sequence_no + 1) & 0xFFFF
        header = struct.pack("!HIHBb", 0xCC1E, self.spec["model_code"], self.sequence_no, self.station_no, 0x00)
        return header + bytes(self.rx_buffer) + bytes(self.rwr_buffer)

    def unpack_cyclic_command(self, payload: bytes):
        if len(payload) >= 10:
            data = payload[10:]
            ry_len, rww_len = len(self.ry_buffer), len(self.rww_buffer)
            if len(data) >= ry_len:
                self.ry_buffer[:] = data[:ry_len]
            if len(data) >= ry_len + rww_len:
                self.rww_buffer[:] = data[ry_len:ry_len + rww_len]
        self.update_buffers()

# ==========================================================
# 4. 多站排程與網路監聽管理器 (預設 0.0.0.0 防 WinError 10049)
# ==========================================================
class MultiStationManager:
    def __init__(self, wildcard_mode: bool = True):
        self.stations: Dict[int, DeviceStation] = {}
        self.wildcard_mode = wildcard_mode
        self.running = False
        self.sock: Optional[socket.socket] = None

    def add_station(self, station_no: int, ip_address: str, model_name: str):
        self.stations[station_no] = DeviceStation(station_no=station_no, ip_address=ip_address, model_name=model_name)
        print(f"[MultiStation] 已註冊站點 #{station_no}: IP={ip_address}, 機種={model_name}")

    def start(self, udp_port: int = 61450):
        self.running = True
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("0.0.0.0", udp_port))
        self.sock.settimeout(0.5)
        print(f"--- 已啟動 0.0.0.0:{udp_port} 萬用監聽 ({len(self.stations)} 站) ---")
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        while self.running and self.sock:
            try:
                data, addr = self.sock.recvfrom(2048)
                if len(data) < 10: continue
                st = self.stations.get(data[8]) or next(iter(self.stations.values()), None)
                if st:
                    log_packet_hex("RX", addr[0], addr[1], data, st.station_no, st.model_name)
                    st.unpack_cyclic_command(data)
                    resp = st.pack_cyclic_response()
                    self.sock.sendto(resp, addr)
                    log_packet_hex("TX", addr[0], addr[1], resp, st.station_no, st.model_name)
            except socket.timeout:
                continue

    def stop(self):
        self.running = False
        if self.sock:
            self.sock.close()

if __name__ == "__main__":
    mgr = MultiStationManager(wildcard_mode=True)
${pythonSetupLines}
    mgr.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        mgr.stop()
`;
}
