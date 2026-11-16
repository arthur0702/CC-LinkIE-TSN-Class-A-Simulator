@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title CC-Link IE TSN Class A 多站模擬器 (尚未實機驗證)

echo ============================================================================
echo   CC-Link IE TSN Class A 多機種從站模擬器 (Windows 快速啟動腳本)
echo ============================================================================
echo.
echo   【特別聲明】
echo   1. 本程式與封包行為目前「尚未經過實體 PLC 主站硬體實機驗證」。
echo   2. 僅供開發測試、封包研究與實驗室隔離環境模擬使用。
echo   3. 嚴禁用於正式生產線或涉及人身安全之工控現場。
echo.
echo ============================================================================
echo.

if not exist "cclink_tsn_gui_simulator.py" (
    echo [錯誤] 找不到模擬器主程式：cclink_tsn_gui_simulator.py
    echo 請確認 run.bat 與 cclink_tsn_gui_simulator.py 位於同一個資料夾內。
    echo.
    pause
    exit /b 1
)

set "PY_CMD="
where python >nul 2>nul
if %errorlevel%==0 (
    set "PY_CMD=python"
    goto :check_tk
)

where py >nul 2>nul
if %errorlevel%==0 (
    set "PY_CMD=py -3"
    goto :check_tk
)

echo [錯誤] 系統未偵測到 Python 3.8+ 執行環境！
echo 請至 https://www.python.org/downloads/ 下載安裝 Python 3，
echo 並於安裝畫面勾選 "Add Python to PATH" 與 "tcl/tk and IDLE"。
echo.
pause
exit /b 1

:check_tk
%PY_CMD% -c "import tkinter" >nul 2>nul
if not %errorlevel%==0 (
    echo [錯誤] 目前的 Python 環境缺乏 tkinter GUI 套件。
    echo 請重新執行 Python 安裝程式並勾選 "tcl/tk and IDLE" 選項。
    echo.
    pause
    exit /b 1
)

echo [資訊] 使用直譯器：%PY_CMD%
echo [資訊] 正在啟動桌面 GUI 模擬器（預設開啟 0.0.0.0 萬用監聽模式）...
echo [提示] 若遇 Windows 防火牆提示，請允許私人/公用網路存取 UDP Port 61450。
echo.

%PY_CMD% "cclink_tsn_gui_simulator.py"
set "EXIT_CODE=%errorlevel%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [警告] 模擬器異常結束，錯誤代碼：%EXIT_CODE%
    pause
)

endlocal
exit /b %EXIT_CODE%
