# CC-Link IE TSN Class A 多機種從站模擬器與封包分析工具

本專案提供一套完整的 **三菱電機（Mitsubishi Electric）CC-Link IE TSN Class A** 遠端從站模擬開發環境，結合 **React / TypeScript 網頁互動規格與多站規劃控制台**，以及 **免第三方相依、純原生 Python Tkinter 桌面版多站模擬器**，協助自動化工程師在缺乏實體從站硬體時，於單一 PC 上即可完成 PLC 主站（iQ-R / iQ-F）之網路掃描、I/O 映射與循環封包除錯。

> ⚠️ **特別聲明（驗證狀態）**：本模擬器與 Windows 啟動腳本目前**尚未經過實體 PLC 主站硬體連線實機驗證**，封包與緩衝區行為皆依據原廠 CSP+ XML 描述檔與公開通訊結構進行軟體模擬。請僅於實驗室隔離測試環境使用，實際上線或實機連線測試前務必由工程師逐項核對與驗證。

---

## 目錄

- [功能特色](#功能特色)
- [支援機種規格一覽](#支援機種規格一覽)
- [快速開始與使用說明](#快速開始與使用說明)
  - [1. 網頁規劃與分析控制台](#1-網頁規劃與分析控制台)
  - [2. Python 桌面 GUI 模擬器](#2-python-桌面-gui-模擬器)
  - [3. GX Works3 主站連線設定指引](#3-gx-works3-主站連線設定指引)
- [資料來源](#資料來源)
- [AI 聲明](#ai-聲明)
- [MIT 授權與免責聲明](#mit-授權與免責聲明)

---

## 功能特色

1. **6 款原廠 CSP+ 機種完整模擬**
   - 依據各機種獨立處理 `RX` / `RY` / `RWr` / `RWw` 記憶體規模，並精確區分數位模組（`RWr0.b11`）與類比模組（`RXB`）之 Remote Ready 握手旗標位置。
2. **單一 PC 多站並行架構（雙監聽模式）**
   - **`0.0.0.0` 萬用監聽模式（預設）**：單一 UDP `61450` Socket 接收所有指向本機之循環封包，依 Header 第 8 Byte 站號（Station No）自動路由回應，免除繁瑣的次要 IP 設定，徹底防止 `WinError 10049`。
   - **獨立 IP 綁定模式**：可搭配內建產生的 Windows `netsh` / PowerShell 或 Linux `ip addr` 指令於網卡配置多個次要 IP，模擬多台獨立實體設備。
3. **即時封包監控面板（Packet Sniffer & Dissector）**
   - 即時呈現最新收發之 UDP 原始 Hex 數據、時間戳與逐欄位剖析（Magic `0xCC1E`、Model Code、Sequence No、Station No、Link Status、Data Payload）。
4. **互動式 I/O 與類比控制工作台**
   - 數位點位 `X0~X1F` 切換開關、`Y0~Y1F` 輸出 LED 監視器；4 通道類比輸入（`-32000 ~ +32000`）滑桿與類比輸出即時電壓換算監視。
5. **連線品質指示燈（Cycle Time & Jitter）**
   - 即時計算各站封包間隔之滑動平均通訊週期與網路抖動值，快速確認 PC 非即時作業系統在 Class A 排程下之通訊穩定度。

---

## 支援機種規格一覽

| 機種型號 | 類別 | Model Code | Device Type | 點數 / 通道規模 | RX / RY | RWr / RWw | Ready 旗標位置 |
| :--- | :---: | :---: | :---: | :--- | :---: | :---: | :---: |
| **NZ2GNCF1-32T** | DO | `0x60010192` | `0x0003` | 32 點電晶體輸出 (40-Pin 插針) | 32b / 32b | 4W / 4W | `RWr0.b11` |
| **NZ2GN2S1-32T** | DO | `0x60010092` | `0x0003` | 32 點電晶體輸出 (彈簧夾端子) | 32b / 32b | 4W / 4W | `RWr0.b11` |
| **NZ2GN2S1-32D** | DI | `0x60010890` | `0x0003` | 32 點數位 DC 輸入 | 32b / 32b | 4W / 4W | `RWr0.b11` |
| **NZ2GN2S1-32DT** | DIO | `0x60010894` | `0x0003` | 16 點輸入 (`X0~XF`) + 16 點輸出 (`Y10~Y1F`) | 32b / 32b | 4W / 4W | `RWr0.b11` |
| **NZ2GN2S-60AD4** | AI | `0x50000002` | `0x0004` | 4 通道高精度類比輸入 (`RWr2~RWr5`) | 32b / 32b | 16W / 16W | `RXB (bit 11)` |
| **NZ2GN2S-60DA4** | AO | `0x50000004` | `0x0004` | 4 通道高精度類比輸出 (`RWw2~RWw5`) | 32b / 32b | 32W / 32W | `RXB (bit 11)` |

---

## 快速開始與使用說明

### 1. 網頁規劃與分析控制台

系統需求：**Node.js 18+**

```bash
# 安裝相依套件
npm install

# 啟動開發伺服器（預設埠號 3000）
npm run dev

# 建置正式版本
npm run build
```

開啟瀏覽器進入控制台後，可依四個分頁操作：
- **1. 機種規格比較表**：查閱 6 款模組之點位、暫存器大小與 Ready 位址差異。
- **2. 記憶體映射與封包監控面板**：切換不同調試機種，操作 X/Y 接點與類比數值，並透過 Sniffer 觀察 UDP Hex 封包結構。
- **3. 單 1 PC 模擬多站評估與管理列表**：動態新增、修改或刪除多個從站，檢視各站即時 Cycle Time / Jitter 與連線品質指示燈，並一鍵複製對應 Python 配置碼與 Windows `netsh` 指令。
- **4. Python 模擬器原始碼產生器**：直接預覽、複製或下載「桌面 GUI 版 (`cclink_tsn_gui_simulator.py`)」與「核心 CLI 版」。

---

### 2. Python 桌面 GUI 模擬器

系統需求：**Python 3.8+**（僅使用 `tkinter`、`socket`、`struct`、`threading`、`queue` 等原生標準函式庫，**無須執行 `pip install`**）。

- **Windows 快速啟動（推薦）**：直接雙擊專案根目錄的 **`run.bat`**，腳本會自動偵測 Python 與 Tkinter 環境、顯示尚未實機驗證之安全聲明並啟動 GUI 模擬器。
- **手動指令啟動**：

```bash
python cclink_tsn_gui_simulator.py
```

**操作步驟：**
1. 啟動後預設載入 3 組從站（`#1 NZ2GNCF1-32T`、`#2 NZ2GN2S1-32D`、`#3 NZ2GN2S-60AD4`）。
2. 可於「**3. 模擬從站管理列表**」分頁新增、點擊選取後修改或刪除站點；若需將站點改為本機實體網卡 IP，可點擊「🌐 帶入本機 IP」。
3. 確認頂部已勾選 **「0.0.0.0 萬用監聽 (防 10049/免設次要 IP)」**（預設已啟用），接著點擊右上角 **「▶ 啟動全部從站監聽」** 即可開始監聽 UDP `61450`。
4. 若需使用獨立次要 IP 模式，取消勾選萬用監聽前，請先點擊「🔍 網卡診斷/netsh 指令」複製批次腳本並以系統管理員身分執行。
5. 若無實體 PLC 在手邊，可在「**2. 即時封包監控面板**」點擊「模擬發送主站封包」驗證收發與欄位解析功能。

---

### 3. GX Works3 主站連線設定指引

1. 於三菱 **GX Works3** 匯入對應型號之 CSP+ 描述檔，將遠端從站拖曳至 CC-Link IE TSN 網路組態中。
2. 設定與 PC 模擬站點相符之 **站號（Station No）** 與 **IP 位址**（與 PC 同網段）。
3. **關鍵通訊設定**：
   - 通訊等級請務必選擇 **Class A**（不可選 Class B）。
   - 通訊週期（Communication Period）建議設為 **16 ms 或 32 ms**，以配合 Windows/Linux 一般作業系統排程。
4. 確認 Windows 防火牆放行 Python 監聽 **UDP Port 61450**，將設定寫入 PLC 並重啟後，主站模組 `D LINK` 綠燈恆亮即完成連線。

---

## 資料來源

本專案之設備參數、記憶體位址映射、Model Code、Device Type 與 Ready/Error 旗標定義，均係解析自專案目錄 `public/assets/aistudio/` 內之 6 份三菱電機原廠 CSP+（Control & Communication System Profile）XML 描述檔：

1. `0x0000_NZ2GNCF1-32T_1_en_53ef3efd.xml`（NZ2GNCF1-32T — 32 點電晶體輸出模組）
2. `0x0000_NZ2GN2S1-32T_1_en_705dbb67.xml`（NZ2GN2S1-32T — 32 點電晶體輸出模組）
3. `0x0000_NZ2GN2S1-32D_1_en_764c50a4.xml`（NZ2GN2S1-32D — 32 點 DC 輸入模組）
4. `0x0000_NZ2GN2S1-32DT_1_en_888dbc7b.xml`（NZ2GN2S1-32DT — 16 點輸入 / 16 點輸出複合模組）
5. `0x0000_NZ2GN2S-60AD4_1_en_eee66392.xml`（NZ2GN2S-60AD4 — 4 通道類比輸入模組）
6. `0x0000_NZ2GN2S-60DA4_1_en_81245328.xml`（NZ2GN2S-60DA4 — 4 通道類比輸出模組）

> 註：Vendor Code `0x0000` 為公開資料中標識之供應商識別碼，所有型號名稱、CSP+ 描述檔規格與 CC-Link IE TSN 商標權益均歸屬於其原權利人（Mitsubishi Electric Corporation / CC-Link Partner Association）。

---

## AI 聲明

- 本專案之軟體架構設計、React/TypeScript 前端控制台、Python Tkinter 桌面模擬器程式碼、封包結構解析邏輯以及技術說明文件，皆係透過 **AI 輔助程式開發生成與重構整理**。
- 雖然程式邏輯已參照上傳之原廠 CSP+ XML 規格反覆校驗與語法檢查，AI 生成程式碼仍可能存在邊界情境未涵蓋之處（例如不同 PLC 韌體版本對封包檔頭或擴充參數之細微差異）。
- **建議使用者於實際連線實體 PLC 測試前，先於安全、隔離之測試網段進行驗證，並由具備自動化控制專業背景之工程師審閱程式碼。**

---

## MIT 授權與免責聲明

本專案程式碼採用 **MIT License** 授權條款釋出（詳見 [LICENSE](./LICENSE) 檔案）：

```text
MIT License

Copyright (c) 2026 CC-Link IE TSN Simulator Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 工業安全與技術免責聲明

1. **尚未經實體硬體實機驗證**：本模擬器（包含網頁版、Python GUI/CLI 版及 `run.bat` 啟動腳本）目前**尚未經過任何實體三菱 PLC 硬體或實機網路交換機之實機連線驗證**，實際封包相容性仍待實體設備測試確認。
2. **非官方產品聲明**：本工具為社群與工程學習測試用途之非官方模擬器，與三菱電機株式會社（Mitsubishi Electric）或 CC-Link 協會（CLPA）無任何官方隸屬或背書關係。
3. **嚴禁用於正式生產線與安全關鍵系統**：本軟體運行於一般非即時作業系統（Windows / Linux），不具備硬體級 IEEE 802.1AS 時間同步與安全防護保證，**僅限於實驗室開發、教育訓練與離線通訊除錯使用，嚴禁直接部署於實際運作中之產線設備或涉及人身安全之工控現場**。
4. **通訊行為免責**：因使用本模擬器進行連線測試、網卡 IP 修改（如 `netsh` 操作）或封包收發所導致之設備異常、網路中斷或任何直接/間接損失，作者與貢獻者概不負責。
