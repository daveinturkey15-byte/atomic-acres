# Reopen the immutable September20 inspection artifact without rebuilding it.
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$dist = Join-Path $taskRoot 'dist-showcase-0500'
$asset = Join-Path $dist 'assets/index-Cw-8jhAl.js'
$expected = '92e691b0393456101a7d59a92420debcfd72fc5f0c1ea35a4746ce7f0c163775'
if ((Get-FileHash -LiteralPath $asset -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Frozen artifact changed; refusing.' }
$listener = Get-NetTCPConnection -LocalPort 4212 -State Listen -ErrorAction SilentlyContinue
if (-not $listener) {
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $vite = Join-Path $taskRoot 'node_modules/vite/bin/vite.js'
    Start-Process -FilePath $node -ArgumentList @(('"' + $vite + '"'),'preview','--host','127.0.0.1','--port','4212','--strictPort','--outDir','dist-showcase-0500') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot '.recovery-runtime/showcase.stdout.txt') -RedirectStandardError (Join-Path $taskRoot '.recovery-runtime/showcase.stderr.txt') | Out-Null
}
$verified = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try {
        $response = Invoke-WebRequest 'http://127.0.0.1:4212/assets/index-Cw-8jhAl.js' -TimeoutSec 3 -UseBasicParsing
        $hash = [System.Security.Cryptography.SHA256]::Create()
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($response.Content)
        $actual = ([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()
        $hash.Dispose()
        if ($actual -ne $expected) { throw 'Port4212 serves another artifact; left untouched.' }
        $verified = $true
        break
    } catch { if ($attempt -eq 19) { throw }; Start-Sleep -Milliseconds 200 }
}
if (-not $verified) { throw 'Showcase did not become ready.' }
Write-Output 'VERIFIED http://127.0.0.1:4212/?operator=authored&lawn=canary&audiobank=2'
