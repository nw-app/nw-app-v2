$ErrorActionPreference = 'Stop'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://localhost:8081/')
$listener.Start()
Write-Host 'Server started at http://localhost:8081/' -ForegroundColor Green
$root = $PSScriptRoot
Write-Host "Root: $root" -ForegroundColor DarkGray

while ($listener.IsListening) {
    try {
        $ctx = $listener.GetContext()
        $req = $ctx.Request
        $resp = $ctx.Response
        $rawPath = $req.Url.LocalPath
        $path = [Uri]::UnescapeDataString($rawPath)
        if ([string]::IsNullOrEmpty($path) -or $path -eq '/') { $path = '/index.html' }
        $trimmed = $path.TrimStart('\', '/')
        $file = Join-Path $root $trimmed
        Write-Host "Request: $rawPath -> $file" -ForegroundColor DarkGray

        if (Test-Path $file -PathType Leaf) {
            $content = [System.IO.File]::ReadAllBytes($file)
            $ext = [System.IO.Path]::GetExtension($file).ToLower()
            $mime = 'application/octet-stream'
            switch ($ext) {
                '.html' { $mime = 'text/html; charset=utf-8' }
                '.js'   { $mime = 'application/javascript; charset=utf-8' }
                '.css'  { $mime = 'text/css; charset=utf-8' }
                '.json' { $mime = 'application/json; charset=utf-8' }
                '.svg'  { $mime = 'image/svg+xml' }
                '.png'  { $mime = 'image/png' }
                '.jpg'  { $mime = 'image/jpeg' }
                '.jpeg' { $mime = 'image/jpeg' }
                '.webp' { $mime = 'image/webp' }
                '.woff' { $mime = 'font/woff' }
                '.woff2'{ $mime = 'font/woff2' }
                '.ttf'  { $mime = 'font/ttf' }
                '.ico'  { $mime = 'image/x-icon' }
            }
            $resp.ContentType = $mime
            $resp.ContentLength64 = $content.Length
            $resp.OutputStream.Write($content, 0, $content.Length)
            $resp.Close()
            Write-Host "200 OK $($content.Length) bytes" -ForegroundColor DarkGray
        } else {
            $resp.StatusCode = 404
            $body = "Not Found: $rawPath`nTried: $file"
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($body)
            $resp.ContentType = 'text/plain; charset=utf-8'
            $resp.ContentLength64 = $buffer.Length
            $resp.OutputStream.Write($buffer, 0, $buffer.Length)
            $resp.Close()
            Write-Host "404 $rawPath" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "Error: $_" -ForegroundColor Red
        try { $ctx.Response.StatusCode = 500; $ctx.Response.Close() } catch {}
    }
}
