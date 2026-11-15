# Tiny static file server for previewing the gallery on Windows.
# No installs needed:   powershell -ExecutionPolicy Bypass -File serve.ps1
# Then open             http://localhost:4173
param([int]$Port = 4173)

$root = $PSScriptRoot
$mime = @{
  ".html" = "text/html; charset=utf-8"; ".css" = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"; ".json" = "application/json"
  ".svg"  = "image/svg+xml"; ".png" = "image/png"; ".jpg" = "image/jpeg"
  ".jpeg" = "image/jpeg"; ".webp" = "image/webp"; ".ico" = "image/x-icon"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Gallery running at http://localhost:$Port  (Ctrl+C to stop)"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
      $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart("/")
      if ($rel -eq "") { $rel = "index.html" }
      $file = [IO.Path]::GetFullPath((Join-Path $root $rel))
      if ($file.StartsWith($root) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($file)
        $type = $mime[[IO.Path]::GetExtension($file).ToLower()]
        if (-not $type) { $type = "application/octet-stream" }
        $ctx.Response.ContentType = $type
        $ctx.Response.Headers.Add("Cache-Control", "no-cache")
        $ctx.Response.ContentLength64 = $bytes.Length
        if ($ctx.Request.HttpMethod -ne "HEAD") {
          $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
      } else {
        $ctx.Response.StatusCode = 404
      }
      Write-Host "$($ctx.Response.StatusCode) /$rel"
    } catch {
      Write-Host "error: $($_.Exception.Message)"   # e.g. the browser closed the connection
    } finally {
      try { $ctx.Response.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
}
