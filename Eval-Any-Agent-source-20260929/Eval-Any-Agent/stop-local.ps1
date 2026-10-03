$ErrorActionPreference = 'Stop'
$statePath = Join-Path $PSScriptRoot '.local/server.json'
if (-not (Test-Path -LiteralPath $statePath)) { Write-Output 'No application process recorded.'; return }
$saved = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
$serverProcessId = [int]$saved.processId
$process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $serverProcessId) -ErrorAction SilentlyContinue
if (-not $process) { Write-Output 'Application is already stopped.'; return }
$expectedCli = Join-Path $PSScriptRoot 'node_modules/next/dist/bin/next'
if (-not $process.CommandLine -or -not $process.CommandLine.Contains($expectedCli)) {
    throw 'Recorded process belongs to another program. Nothing was stopped.'
}
Stop-Process -Id $serverProcessId -ErrorAction Stop
Write-Output 'Eval-Any-Agent stopped. The database and configuration are preserved.'
