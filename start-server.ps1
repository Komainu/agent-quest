# start-server.ps1 — Agent Quest をこのパソコンの中だけで開く小さなサーバー
# ファイルを直接（file://）開くと、MetaMask はページとやりとりできない。
# http://localhost で開けば、ウォレットにつなげる。外からは見えない（localhost だけ）。
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'deploy'))
if (-not (Test-Path (Join-Path $root 'index.html'))) {
  Write-Host 'deploy\index.html が見つかりません。'
  Read-Host 'Enter で閉じます'; exit 1
}
$listener = $null; $port = 0
foreach ($p in 8080..8099) {
  try {
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://localhost:$p/")
    $l.Start(); $listener = $l; $port = $p; break
  } catch { }
}
if (-not $listener) { Write-Host '空いているポートがありません（8080〜8099）。'; Read-Host 'Enter で閉じます'; exit 1 }
$url = "http://localhost:$port/"
Write-Host ''
Write-Host "  Agent Quest を開きました： $url"
Write-Host '  MetaMask が入っている Chrome で、このアドレスを開いてください。'
Write-Host '  使い終わったら、この黒い窓を閉じてください。'
Write-Host ''
Start-Process $url
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8';
            '.json'='application/json; charset=utf-8'; '.png'='image/png'; '.svg'='image/svg+xml'; '.ico'='image/x-icon'; '.txt'='text/plain; charset=utf-8'; '.webmanifest'='application/manifest+json' }
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '' -or $rel.EndsWith('/')) { $rel = $rel + 'index.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
    if ($full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path $full -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($full)
      $ext = [IO.Path]::GetExtension($full).ToLower()
      $res.ContentType = $(if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' })
      $res.Headers.Add('Cache-Control', 'no-store')
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
    }
  } catch { $res.StatusCode = 500 }
  finally { $res.Close() }
}
