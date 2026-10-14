[CmdletBinding()]
param(
  [string]$EnvironmentFile = (Join-Path $PSScriptRoot '..\.env'),
  [string]$TargetHost = '2.24.221.121',
  [string]$TargetUser = 'root',
  [switch]$SkipFirstBackup
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
  throw "Environment file not found: $EnvironmentFile"
}

$settings = @{}
foreach ($line in Get-Content -LiteralPath $EnvironmentFile) {
  if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    $settings[$Matches[1]] = $Matches[2]
  }
}

$required = @('R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY')
foreach ($name in $required) {
  if ([string]::IsNullOrWhiteSpace([string]$settings[$name])) {
    throw "$name is missing or empty in $EnvironmentFile"
  }
  if ([string]$settings[$name] -match "[`r`n]") {
    throw "$name contains an invalid newline"
  }
}

$payload = ($required | ForEach-Object { "$_=$($settings[$_])" }) -join "`n"
$remoteCommand = @'
set -eu
umask 077
credential_file=$(mktemp /opt/servers/omnireach/shared/config/.r2-credentials.XXXXXX)
trap 'rm -f "$credential_file"' EXIT HUP INT TERM
cat >"$credential_file"
chmod 0600 "$credential_file"
installer=/opt/servers/omnireach/current/infrastructure/backups/install-backup-service.sh
[ -x "$installer" ]
'@

if ($SkipFirstBackup) {
  $remoteCommand += "`n`"`$installer`" --credentials-file `"`$credential_file`" --enable"
} else {
  $remoteCommand += "`n`"`$installer`" --credentials-file `"`$credential_file`" --enable --run-now"
}

$payload | & ssh -o StrictHostKeyChecking=yes "$TargetUser@$TargetHost" $remoteCommand
if ($LASTEXITCODE -ne 0) {
  throw "Remote backup configuration failed with exit code $LASTEXITCODE"
}

Write-Host 'R2 backup service configured without printing credential values.'
