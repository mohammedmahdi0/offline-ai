@echo off
rem Offline AI - normal start (uses Ollama). (c) Mohammed Mahdi @mo.79u - MIT License
title Offline AI
cd /d "%~dp0"
where ollama >nul 2>nul || (
  echo Ollama is not installed. Download it from https://ollama.com/download
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\serve.ps1"
