@echo off
setlocal
set "PYTHON_DIR=%~dp0.python"
set "PATH=%PYTHON_DIR%;%PYTHON_DIR%\Scripts;%PATH%"
python %~dp0app.py
pause
