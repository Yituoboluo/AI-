$ErrorActionPreference = 'Stop'
$projectDirectory = $PSScriptRoot
$stateDirectory = Join-Path $projectDirectory '.local'
$statePath = Join-Path $stateDirectory 'server.json'
$nextCli = Join-Path $projectDirectory 'node_modules/next/dist/bin/next'
$environmentPath = Join-Path $projectDirectory '.env'

if (-not (Test-Path -LiteralPath (Join-Path $projectDirectory '.next/BUILD_ID'))) {
    throw 'Production build not found. Run npm run build first.'
}
if (-not (Test-Path -LiteralPath $environmentPath)) {
    throw 'Local configuration .env is missing.'
}

$port = 3000
foreach ($line in Get-Content -LiteralPath $environmentPath -Encoding UTF8) {
    if ($line -match '^APP_PORT="?(\d+)"?$') { $port = [int]$Matches[1] }
}
$baseUrl = 'http://127.0.0.1:' + $port

if (Test-Path -LiteralPath $statePath) {
    $saved = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $existingProcess = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$saved.processId) -ErrorAction SilentlyContinue
    if ($existingProcess -and $existingProcess.CommandLine -and $existingProcess.CommandLine.Contains($nextCli)) {
        try {
            $health = Invoke-RestMethod -Uri ($baseUrl + '/api/health') -TimeoutSec 5
            if ($health.ok) { Write-Output ('Already running: ' + $baseUrl + '/login'); return }
        } catch {}
        throw 'The recorded application process exists but is not healthy. Check .local/server.stderr.log.'
    }
}

$listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
if ($listener) { throw ('Port ' + $port + ' is already in use. Existing services were not stopped.') }

New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
$env:NEXT_TELEMETRY_DISABLED = '1'
$serverProcess = Start-Process -FilePath $nodeExecutable `
    -ArgumentList @(('"' + $nextCli + '"'), 'start', '--hostname', '127.0.0.1', '--port', $port) `
    -WorkingDirectory $projectDirectory -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $stateDirectory 'server.stdout.log') `
    -RedirectStandardError (Join-Path $stateDirectory 'server.stderr.log') -PassThru

@{ processId = $serverProcess.Id; projectDirectory = $projectDirectory; baseUrl = $baseUrl; startedAt = (Get-Date).ToUniversalTime().ToString('o') } |
    ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8

for ($attempt = 0; $attempt -lt 40; $attempt++) {
    if ($serverProcess.HasExited) { throw 'Application exited. Check .local/server.stderr.log.' }
    try {
        $health = Invoke-RestMethod -Uri ($baseUrl + '/api/health') -TimeoutSec 2
        if ($health.ok) { Write-Output ('Started: ' + $baseUrl + '/login'); return }
    } catch {}
    Start-Sleep -Milliseconds 500
    $serverProcess.Refresh()
}
throw 'Application startup timed out. Check .local/server.stdout.log and .local/server.stderr.log.'
