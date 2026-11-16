# Wait for the already-running native-media benchmark before reusing a concurrency-limited key.
param([int]$ExistingProcessId)
$ErrorActionPreference = 'Stop'
if ($ExistingProcessId -gt 0) {
    Write-Output 'Waiting for the existing media benchmark to exit; no additional API requests yet.'
    Wait-Process -Id $ExistingProcessId -ErrorAction SilentlyContinue
}
node scripts/benchmark-messages.mjs --provider=google --run=paid-provider --resume
exit $LASTEXITCODE
