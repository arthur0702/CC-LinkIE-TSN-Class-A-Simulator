# CC-Link IE TSN Class A 多機種從站模擬器 — 開發流程與問題處理報告

本報告完整記錄「CC-Link IE TSN Class A 多機種、多站從站模擬器」從需求分析、架構演進、系統實作，到實際部署階段所遭遇之技術問題與最終解決方案。

---

## 一、系統開發流程（Development Lifecycle）

專案歷經五個主要迭代階段完成：

### 階段一：CSP+ XML 規格解析與多機種架構建立
- **需求**：從單一機種（`NZ2GNCF1-32T`）擴展至支援使用者上傳的 6 份三菱原廠 CSP+ 描述檔，並評估單一 PC 模擬多站之可行性。
- **分析與關鍵發現**：
  1. **通訊等級確認**：6 份 CSP+ 的 `<CertificationClassChoice>` 皆支援 **Class A**，意味著可用標準 UDP/IP（Port `61450`）非同步排程達成通訊，無須專用 IEEE 802.1AS PTP 硬體網卡。
  2. **機種暫存器結構差異**：
     - 數位模組（`32T` / `32D` / `32DT`）：`RWr/RWw` 各 4 Words，**Remote Ready 旗標位於 `RWr0.b11`**，錯誤碼在 `RWr1`。
     - 類比模組（`60AD4` / `60DA4`）：`RWr/RWw` 擴展為 16 Words（60AD4）與 32 Words（60DA4），且 **Remote Ready 旗標位於 `RXB`（RX bit 11）**、異常旗標位於 `RXA`、錯誤碼位於 `RWr0`。
     - 複合模組（`32DT`）：`X0~XF` 為前 16 點輸入，`Y10~Y1F` 對應 RY 第 16~31 位元輸出。
- **產出**：建立 `SUPPORTED_DEVICES` 規格目錄與動態 I/O 映射切換機制。

### 階段二：互動式多站管理列表與 Python CLI 程式碼同步
- **需求**：讓使用者免手動修改 Python 程式碼即可動態管理多站設定，並產生對應網卡設定指令。
- **實作**：
  - 建立 `ConfiguredStation` 資料模型，於網頁端提供站號（1~254）、IP、機種的驗證與範本載入（3 站混合、全數位 4 站、全類比 2 站）。
  - 動態組裝 `MultiStationManager` 初始化片段與 Windows PowerShell / `netsh`、Linux `ip addr` 次要 IP 綁定指令。

### 階段三：即時封包監控面板（Packet Sniffer & Dissector）
- **需求**：顯示最近 5 筆 UDP `61450` 原始封包之 Hex 數據與時間戳，協助確認主從站循環通訊行為。
- **實作**：
  - 實作 Big-Endian 10-Byte 循環幀 Header（`!HIHBb`: `0xCC1E` + `ModelCode` + `SeqNo` + `StationNo` + `Status`）與 Little-Endian Payload（`RX/RWr` 或 `RY/RWw`）之色彩分區呈現與點擊剖析面板。

### 階段四：原生 Python Tkinter 桌面版 GUI 模擬器開發與穩定性指標
- **需求**：開發無須第三方相依、可直接在工程現場 PC 執行的獨立桌面視窗模擬器，並加入 **站點增修刪（CRUD）** 與 **連線品質指示燈（Cycle Time / Jitter）**。
- **實作**：
  - 採用 `threading` 背景執行 UDP Socket 監聽，透過 `queue.Queue` + `root.after(50, ...)` 將封包與 I/O 更新安全投遞至 Tkinter 主執行緒，避免 GUI 跨執行緒操作崩潰。
  - 利用最近 20 筆封包間隔時間計算滑動平均通訊週期（Cycle Time）與抖動值（Jitter），並以綠（`<= 1.2ms`）/ 黃（`<= 3.0ms`）/ 紅（`> 3.0ms`）燈號呈現連線穩定性。

### 階段五：程式碼清理、架構模組化與 GitHub 文件化
- **執行工作**：
  - 將共用的機種規格與封包邏輯抽離至 `src/data/tsnCatalog.ts`，消除 `src/App.tsx` 冗餘狀態與未使用的匯入元件。
  - 精簡網頁 UI：移除多餘裝飾標籤與重複教學區塊，修正分頁排序（`1` → `2` → `3` → `4`）與表格欄位數錯位，並將整體品質評級改由即時數據動態計算。
  - 補齊 Python 與 TypeScript 全檔案繁體中文註解，產出 `README.md`、`LICENSE` 與本報告。

---

## 二、開發過程遭遇問題與處理紀錄（Troubleshooting Log）

| 問題編號 | 發生階段 / 現象 | 根本原因剖析 | 處理方式與最終修正 |
| :---: | :--- | :--- | :--- |
| **#1** | **Windows 啟動模擬器拋出 `WinError 10049`（內容所要求的位址不正確）** | Windows Winsock 規定呼叫 `socket.bind((IP, Port))` 時，該 IP 必須已存在於本機網卡上；模擬器預設的 `192.168.3.10~12` 若未先於系統網卡新增次要 IP，綁定即會失敗。 | 1. 新增 **「`0.0.0.0` 萬用監聽模式」（預設啟用）**：單一 Socket 監聽所有介面，依封包內 `data[8]` 站號自動分流回應，免設次要 IP 即可 100% 啟動。<br>2. 加入本機 IP 自動偵測、「複製 `netsh` 批次指令」與 `WINERROR_10049` 彈窗一鍵自動切換修復精靈。 |
| **#2** | **Python 啟動瞬間閃退：`AttributeError: 'CCLinkTSNSimulatorGUI' object has no attribute 'st_info_lbl'`** | UI 重構調整頂部工具列時曾遺漏建立 `self.st_info_lbl` 元件，但 `_build_notebook()` 呼叫 `_refresh_workbench()` 時嘗試更新該標籤文字導致程式啟動即崩潰。 | 於 `_build_top_bar()` 恢復建立 `self.st_info_lbl`（即時顯示當前調試站點之 IP、機種與 Ready 位址），並於 `_refresh_workbench()` 加上 `hasattr(self, "st_info_lbl")` 防護檢查。 |
| **#3** | **Vite / Rolldown 編譯 `pythonGuiCode.ts` 發生 Unicode Escape 語法錯誤** | 直接以 JS 樣板字串（Template Literal）包覆內含 `\n`、shebang 與正則字串的完整 Python 程式碼時，跳脫字元在編譯期遭誤判。 | 改用 Node.js 腳本讀取 `cclink_tsn_gui_simulator.py` 原檔並透過 `JSON.stringify()` 序列化寫入 `src/pythonGuiCode.ts`，確保內容與單檔 100% 一致且無跳脫衝突。 |
| **#4** | **TypeScript 編譯錯誤 `TS2345`（`quality` 型別推斷為 `string`）** | 在 React `map()` 內使用三元運算子回傳 `'excellent'` 或 `'offline'` 時，TypeScript 將其寬化為 `string`，無法賦值給聯合型別 `'excellent' \| 'fair' \| 'poor' \| 'offline'`。 | 於回傳字面值加上 `as const` 型別斷言，確保嚴格型別通過 `tsc --noEmit` 與 `npm run build`。 |
| **#5** | **網頁端多站列表表格欄位數不一致（`thead` 9 欄 vs `tbody` 10 欄）** | `tbody` 多渲染了一個重複顯示 IP 的 `<td>IP: {st.ipAddress} (Class A)</td>`，導致右側「操作」欄在桌機版向右偏移。 | 於代碼清理階段移除重複的 `<td>` 儲存格，使標題列與資料列嚴格對齊為 9 欄；同時移除未使用的 `qualityDot`、`handleDeleteStation` 與 `useRef`。 |
| **#6** | **Python GUI 運行期間新增或修改站點後監聽狀態不同步** | 在啟用模擬狀態下若新增或修改站點，僅 `0.0.0.0` 模式或獨立執行緒其中一側未同步將 `st.running` 設為 `True`。 | 於 `_add_station_from_ui()` 與 `_edit_station_from_ui()` 中依據 `self.bind_all_interfaces.get()` 狀態自動標記 `st.running = True` 或啟動獨立執行緒。 |

---

## 三、總結與驗證方式

- **單機多站評估結論**：在 CC-Link IE TSN Class A 規範下，單一普通 PC 搭配 Python 多執行緒與單播 UDP Socket，實務上可穩定承載 **16 ~ 32 個模擬從站**（建議主站掃描週期設為 `16 ~ 32 ms`）。
- **Windows 一鍵啟動輔助**：新增 `run.bat` 批次檔，自動檢查 Python 3 與 Tkinter 環境並於啟動視窗顯示免責聲明後開啟 GUI 模擬器。
- **自動化檢查項目（已通過）**：
  - Python 語法編譯驗證：`python3 -m py_compile cclink_tsn_gui_simulator.py`
  - 前端型別與打包驗證：`npm run lint`（`tsc --noEmit`）與 `npm run build`（Vite production bundle）
- **驗證邊界特別聲明**：截至目前為止，本專案所有模擬器程式與封包邏輯**尚未經過實體 PLC 主站硬體（如 R04CPU / RJ71GN11-T2 / FX5-TSN）進行實機連線驗證**，實際上線測試前需於隔離實驗網段進行實機封包握手確認。
