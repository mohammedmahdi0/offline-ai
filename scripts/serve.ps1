<#
  Offline AI - tiny local web server for the chat page (no Python/Node needed).
  Serves the project folder at http://localhost:<Port>/ so the browser can talk to Ollama
  (Ollama only accepts requests from localhost pages by default).

  (c) Mohammed Mahdi (@mo.79u) - MIT License
#>
param([int]$Port = 5180, [switch]$NoBrowser, [ValidateSet('', 'ollama', 'llamacpp')][string]$Engine = '',
      [string]$Model = '')   # e.g. qwen3.5:0.8b - the page opens with this Ollama model selected

$root = Split-Path $PSScriptRoot -Parent
$types = @{
    '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
    '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.ico' = 'image/x-icon'
    '.ttf' = 'font/ttf'; '.woff2' = 'font/woff2'; '.json' = 'application/json'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$url = "http://localhost:$Port/"
$query = @()
if ($Engine) { $query += "engine=$Engine" }
if ($Model)  { $query += 'model=' + [Uri]::EscapeDataString($Model) }
if ($query)  { $url += '?' + ($query -join '&') }
try { $listener.Start() } catch {
    Write-Host "Port $Port is busy - the chat page is probably already running." -ForegroundColor Yellow
    if (-not $NoBrowser) { Start-Process $url }
    exit
}

Write-Host ""
Write-Host "  Offline AI chat:  $url" -ForegroundColor Cyan
Write-Host "  Keep this window open while you chat. Close it to stop." -ForegroundColor DarkGray
Write-Host ""
if (-not $NoBrowser) { Start-Process $url }

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
        $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
        if (-not $rel) { $rel = 'index.html' }
        $path = [IO.Path]::GetFullPath((Join-Path $root $rel))
        # stay inside the project folder
        if ($path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path $path -PathType Leaf)) {
            $bytes = [IO.File]::ReadAllBytes($path)
            $ext = [IO.Path]::GetExtension($path).ToLower()
            $res.ContentType = if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' }
            $res.Headers.Add('Cache-Control', 'no-cache')
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $res.StatusCode = 404
        }
    } catch {
        $res.StatusCode = 500
    } finally {
        $res.Close()
    }
}
