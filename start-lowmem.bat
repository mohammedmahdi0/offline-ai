@echo off
rem Offline AI - low-memory start (llama-server inside Ollama, mmap, works without a page file).
rem (c) Mohammed Mahdi @mo.79u - MIT License
title Offline AI - model
cd /d "%~dp0"
start "Offline AI - chat page" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\serve.ps1" -Engine llamacpp
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-llama-server.ps1" %*
pause
