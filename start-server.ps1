# Local static server for Potian Roguelike (no Python required)
param([int]$Port = 5173)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$Mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.txt'  = 'text/plain; charset=utf-8'
  '.md'   = 'text/plain; charset=utf-8'
  '.woff' = 'font/woff'
  '.woff2'= 'font/woff2'
}

function Get-FreePort([int]$start) {
  for ($p = $start; $p -lt $start + 20; $p++) {
    try {
      $used = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue
      if (-not $used) { return $p }
    } catch {
      return $start
    }
  }
  return $start
}

try { $Port = Get-FreePort $Port } catch { }

$url = "http://127.0.0.1:$Port/"
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($url)

try {
  $listener.Start()
} catch {
  Write-Host ""
  Write-Host "[ERROR] Cannot bind port $Port"
  Write-Host $_.Exception.Message
  Write-Host "Close other apps using this port, then retry."
  Write-Host ""
  cmd /c pause
  exit 1
}

Write-Host ""
Write-Host " ========================================"
Write-Host "  Potian Roguelike is running"
Write-Host "  $url"
Write-Host "  Keep this window OPEN while playing"
Write-Host "  Close window = stop server"
Write-Host " ========================================"
Write-Host ""

Start-Process $url

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }
    $rel = $rel -replace '/', '\'
    $path = Join-Path $Root $rel
    $fullRoot = (Resolve-Path $Root).Path
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      $res.StatusCode = 404
      $bytes = [Text.Encoding]::UTF8.GetBytes("404 Not Found: $rel")
      $res.ContentType = 'text/plain; charset=utf-8'
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $resolved = (Resolve-Path -LiteralPath $path).Path
      if (-not $resolved.StartsWith($fullRoot, [StringComparison]::OrdinalIgnoreCase)) {
        $res.StatusCode = 403
      } else {
        $ext = [IO.Path]::GetExtension($resolved).ToLowerInvariant()
        $ctype = $Mime[$ext]
        if (-not $ctype) { $ctype = 'application/octet-stream' }
        $bytes = [IO.File]::ReadAllBytes($resolved)
        $res.StatusCode = 200
        $res.ContentType = $ctype
        $res.ContentLength64 = $bytes.LongLength
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      }
    }
  } catch {
    try { $res.StatusCode = 500 } catch {}
  } finally {
    try { $res.OutputStream.Close() } catch {}
  }
}
