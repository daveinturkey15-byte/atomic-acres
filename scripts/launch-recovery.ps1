param([switch]$OpenBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectRoot '.recovery-runtime'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist\index.html'))) {
    throw 'Build is missing. Run npm run build in the recovery worktree first.'
}
function Start-LocalService([int]$Port, [string]$Script, [string[]]$ServiceArgs, [string]$Name) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if ($listener) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener[0].OwningProcess)"
        if ($process.CommandLine -notlike "*$Script*") { throw "Port $Port belongs to another service; left untouched." }
        return
    }
    Start-Process -FilePath $nodeExe -ArgumentList (@('"' + $Script + '"') + $ServiceArgs) `
        -WorkingDirectory $projectRoot -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $runtimeDir "$Name.stdout.txt") `
        -RedirectStandardError (Join-Path $runtimeDir "$Name.stderr.txt") | Out-Null
}
$vite = Join-Path $projectRoot 'node_modules\vite\bin\vite.js'
# node_modules is a junction into the original checkout; its executable path can
# therefore be either spelling, while the provenance endpoint identifies the build.
if (-not (Get-NetTCPConnection -State Listen -LocalPort 4191 -ErrorAction SilentlyContinue)) {
    Start-LocalService 4191 $vite @('preview','--port','4191','--strictPort','--host','127.0.0.1') 'preview'
}
for ($i=0; $i -lt 50; $i++) {
    try {
        $identity = Invoke-RestMethod 'http://127.0.0.1:4191/build-info.json' -TimeoutSec 2
        if ($identity.project -ne 'nuketown-2025-standalone' -or $identity.lane -ne 'recovery/wave7-20260919') {
            throw 'Port 4191 serves a different build; left untouched.'
        }
        break
    } catch {
        if ($i -eq 49) { throw }
        Start-Sleep -Milliseconds 200
    }
}
Start-LocalService 4310 (Join-Path $projectRoot 'scripts\net-signal.mjs') @('--port','4310','--host','127.0.0.1') 'signal'
if ($OpenBrowser) { Start-Process 'http://127.0.0.1:4191/' }
