@echo off
rem Offline AI - normal start (uses Ollama). (c) Mohammed Mahdi @mo.79u - MIT License
title Offline AI
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-ollama.ps1"
if errorlevel 1 (
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\serve.ps1"
