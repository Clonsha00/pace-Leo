param([string]$Ip)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$taskPython = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) { $taskPython = 'py' }
if (-not $Ip) {
  Write-Host 'Enter the computer LAN IPv4 address (the one used by M5 SERVER_URL).'
  $Ip = Read-Host 'Computer IPv4'
}
& $taskPython make_cert.py $Ip
if ($LASTEXITCODE -ne 0) { throw 'Certificate generation failed. This Python needs cryptography: python -m pip install cryptography' }
Write-Host "iPhone certificate: http://${Ip}:8765/lan-ca.cer"
Write-Host "iPhone PACE: https://${Ip}:8443"
Write-Host 'Stop the old server.py before starting this relay. Keep this window open.'
& $taskPython -u server.py --cert .local/server.pem --key .local/server-key.pem
if ($LASTEXITCODE -ne 0) { throw 'Relay stopped. Check whether the old server is still using port 8765.' }
