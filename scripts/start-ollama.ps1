<#
  Offline AI - makes sure Ollama is installed and running before the chat page opens.
  Finds ollama.exe even when the PATH of this window predates the install, and starts
  the Ollama app (or "ollama serve") if nothing answers on port 11434.

  (c) Mohammed Mahdi (@mo.79u) - MIT License
#>
$api = 'http://127.0.0.1:11434/api/version'
function Test-Ollama { try { $null = Invoke-RestMethod $api -TimeoutSec 2; $true } catch { $false } }

if (Test-Ollama) { exit 0 }

$exe = (Get-Command ollama -ErrorAction SilentlyContinue).Source
if (-not $exe) {
    $dirs = @(Join-Path $env:LOCALAPPDATA 'Programs\Ollama') +
            ([Environment]::GetEnvironmentVariable('Path', 'User') -split ';') +
            ([Environment]::GetEnvironmentVariable('Path', 'Machine') -split ';')
    $exe = $dirs | Where-Object { $_ } | ForEach-Object { Join-Path $_ 'ollama.exe' } |
           Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $exe) {
    Write-Host ''
    Write-Host '  Ollama is not installed.' -ForegroundColor Yellow
    Write-Host '  Download it from https://ollama.com/download then run start.bat again.'
    Write-Host ''
    exit 1
}

Write-Host '  Starting Ollama...' -ForegroundColor DarkGray
$app = Join-Path (Split-Path $exe) 'ollama app.exe'
if (Test-Path $app) {
    Start-Process $app
    for ($i = 0; $i -lt 10; $i++) { Start-Sleep 1; if (Test-Ollama) { exit 0 } }
}
# the tray app did not bring the server up (or is missing): run the server directly
Start-Process $exe -ArgumentList 'serve' -WindowStyle Hidden
for ($i = 0; $i -lt 30; $i++) { Start-Sleep 1; if (Test-Ollama) { exit 0 } }
Write-Host '  Ollama did not start. Open "Ollama" from the Start menu, then run start.bat again.' -ForegroundColor Yellow
exit 1
