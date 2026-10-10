@echo off
@chcp 65001 >nul
title Cabinet Assistant
echo ========================================================
echo   Cabinet Assistant Studio
echo ========================================================
echo.

python -c "import PIL" 2>nul
if %errorlevel% neq 0 (
    echo [Info] Installing Pillow...
    pip install Pillow
)

python "%~dp0editor.py"
pause
