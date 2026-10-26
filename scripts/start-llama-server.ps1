<#
  Offline AI - low-memory launcher
  Runs a model you already pulled with Ollama through the llama-server that ships inside Ollama,
  using mmap + no pinned memory + no repack. Use this when `ollama run` fails with
  "unable to allocate CUDA_Host buffer" (e.g. Windows with no page file).

  (c) Mohammed Mahdi (@mo.79u) - MIT License
#>
param(
    [string]$Model     = 'qwen3.8:27b-q4_K_M',
    [int]   $GpuLayers = 14,       # lower this if you get "cudaMalloc failed: out of memory"
    [int]   $Ctx       = 8192,     # conversation memory in tokens
    [int]   $Port      = 8089,
    [switch]$NoVision              # skip the image projector to save ~1 GB of VRAM
)
$ErrorActionPreference = 'Stop'

# --- locate Ollama install and model store --------------------------------------------
$ollamaExe = (Get-Command ollama -ErrorAction SilentlyContinue).Source
if (-not $ollamaExe) {
    # PATH of an already-open window may predate the install: also check the saved PATH entries
    $dirs = @(Join-Path $env:LOCALAPPDATA 'Programs\Ollama') +
            ([Environment]::GetEnvironmentVariable('Path', 'User') -split ';') +
            ([Environment]::GetEnvironmentVariable('Path', 'Machine') -split ';')
    $ollamaExe = $dirs | Where-Object { $_ } | ForEach-Object { Join-Path $_ 'ollama.exe' } |
                 Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $ollamaExe) { throw 'Ollama not found - install it from https://ollama.com/download' }
$libDir = Join-Path (Split-Path $ollamaExe) 'lib\ollama'
$server = Join-Path $libDir 'llama-server.exe'
if (-not (Test-Path $server)) { throw "llama-server.exe not found under $libDir - is Ollama installed?" }

$store = $env:OLLAMA_MODELS
if (-not $store) { $store = [Environment]::GetEnvironmentVariable('OLLAMA_MODELS', 'User') }
if (-not $store) { $store = Join-Path $HOME '.ollama\models' }

# --- read the Ollama manifest to find the GGUF blobs -----------------------------------
$name, $tag = $Model -split ':', 2
if (-not $tag) { $tag = 'latest' }
if ($name -notmatch '/') { $name = "library/$name" }
$manifest = Join-Path $store "manifests\registry.ollama.ai\$name\$tag"
if (-not (Test-Path $manifest)) { throw "Model '$Model' not found. Run first:  ollama pull $Model" }
$layers = (Get-Content $manifest -Raw | ConvertFrom-Json).layers
function BlobPath($type) {
    $l = $layers | Where-Object mediaType -eq "application/vnd.ollama.image.$type" | Select-Object -First 1
    if ($l) { Join-Path $store ('blobs\' + ($l.digest -replace ':', '-')) }
}
$weights   = BlobPath 'model'
$projector = BlobPath 'projector'

# --- CUDA backend (llama-server only scans its own folder) -----------------------------
$cuda = Get-ChildItem $libDir -Directory -Filter 'cuda_v*' | Sort-Object Name -Descending | Select-Object -First 1
if ($cuda) {
    $env:PATH = "$($cuda.FullName);$libDir;$env:PATH"
    $env:GGML_BACKEND_PATH = Join-Path $cuda.FullName 'ggml-cuda.dll'
}

# Never run two models at once
Get-Process llama-server -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 1

$srvArgs = @('-m', $weights, '--load-mode', 'mmap', '--no-host', '--no-repack', '--fit', 'off',
          '-ngl', $GpuLayers, '-c', $Ctx, '--jinja', '-a', $Model, '--host', '127.0.0.1', '--port', $Port)
if ($projector -and -not $NoVision) { $srvArgs += @('--mmproj', $projector) } else { $srvArgs += '--no-mmproj' }

Write-Host ""
Write-Host "  Offline AI  -  $Model" -ForegroundColor Cyan
Write-Host "  GPU layers: $GpuLayers   context: $Ctx   vision: $([bool]($projector -and -not $NoVision))"
Write-Host "  API ready at http://127.0.0.1:$Port   (Ctrl+C to stop)" -ForegroundColor DarkGray
Write-Host ""
& $server @srvArgs
