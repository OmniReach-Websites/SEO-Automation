param(
  [string]$BaseUri = 'https://admin.omnireach.cloud',
  [string]$Email = 'rhajj@omnireach.cloud',
  [ValidateSet('email_code', 'totp')]
  [string]$Method = 'email_code'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Reveal-SecureString([Security.SecureString]$Value) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

$origin = $BaseUri.TrimEnd('/')
$tokenValue = $null
$passwordValue = $null
$confirmationValue = $null

try {
  $tokenValue = Reveal-SecureString (Read-Host 'Paste the one-time owner bootstrap token' -AsSecureString)
  $prepared = Invoke-RestMethod -Method Post -Uri "$origin/auth/owner-bootstrap/prepare" `
    -Headers @{ Origin = $origin } -ContentType 'application/json' `
    -Body (@{ email = $Email; method = $Method; token = $tokenValue } | ConvertTo-Json -Compress)

  if ($Method -eq 'totp') {
    Write-Host ''
    Write-Host 'Add this account to your authenticator app using its setup-key/URI option:'
    Write-Host $prepared.uri
    $secretMatch = [regex]::Match([string]$prepared.uri, '[?&]secret=([^&]+)')
    if ($secretMatch.Success) {
      Write-Host ''
      Write-Host 'Manual authenticator setup key:'
      Write-Host ([Uri]::UnescapeDataString($secretMatch.Groups[1].Value))
    }
  }
  Write-Host ''
  Write-Host 'Store these recovery codes in your approved encrypted storage before continuing:'
  $prepared.recoveryCodes | ForEach-Object { Write-Host $_ }
  Write-Host ''
  $recoveryAcknowledgment = Read-Host 'Type STORED after saving every recovery code securely'
  if ($recoveryAcknowledgment -cne 'STORED') {
    throw 'Owner bootstrap stopped because recovery-code custody was not acknowledged'
  }

  $displayName = Read-Host 'Owner display name'
  $passwordValue = Reveal-SecureString (Read-Host 'Choose a 12-128 character password' -AsSecureString)
  $confirmationValue = Reveal-SecureString (Read-Host 'Confirm the password' -AsSecureString)
  if ($passwordValue -cne $confirmationValue) { throw 'Passwords do not match' }
  if ($passwordValue.Length -lt 12 -or $passwordValue.Length -gt 128) {
    throw 'Password must contain between 12 and 128 characters'
  }
  $codePrompt = if ($Method -eq 'totp') {
    'Current six-digit authenticator code'
  }
  else {
    'Eight-digit verification code sent to the owner email address'
  }
  $code = Read-Host $codePrompt

  Invoke-RestMethod -Method Post -Uri "$origin/auth/owner-bootstrap/complete" `
    -Headers @{ Origin = $origin } -ContentType 'application/json' `
    -Body (@{
      code = $code
      displayName = $displayName
      newPassword = $passwordValue
      recoveryCodesAcknowledged = $true
      setupId = $prepared.setupId
      token = $tokenValue
    } | ConvertTo-Json -Compress)

  Write-Host 'Owner bootstrap completed. Sign in at https://admin.omnireach.cloud/login'
}
finally {
  $tokenValue = $null
  $passwordValue = $null
  $confirmationValue = $null
}
