@echo off
chcp 65001 >nul
title Cabinet Assistant · 标注工作台
echo ========================================================
echo   Cabinet Assistant — 珍奇柜空间制图与遥感标注工作台
echo ========================================================
echo.

python -c "import PIL" 2>nul
if %errorlevel% neq 0 (
    echo [提示] 正在安装图像处理依赖 Pillow...
    pip install Pillow
)

python "%~dp0editor.py"
pause
