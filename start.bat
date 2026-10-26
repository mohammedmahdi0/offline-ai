@echo off
rem Offline AI - normal start (uses Ollama). (c) Mohammed Mahdi @mo.79u - MIT License
rem Optional: start.bat qwen3.5:0.8b   opens the chat page with that model selected.
title Offline AI
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-ollama.ps1"
if errorlevel 1 (
  pause
  exit /b 1
)
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\serve.ps1"
  exit /b
)
ollama show "%~1" >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Model "%~1" is not downloaded. Run first:  ollama pull %~1
  echo   Models you have:
  ollama list
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\serve.ps1" -Model "%~1"
