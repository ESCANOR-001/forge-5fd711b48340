$ErrorActionPreference = 'Stop'

# Scope the ACL change to a new, empty directory, never the runner's shared temp.
# Native Windows SSH rejects the ARM runner's default Authenticated Users ACE.
$checkoutTemp = Join-Path $env:RUNNER_TEMP 'glinkbot-source-auth'
if (Test-Path -LiteralPath $checkoutTemp) { throw 'Checkout auth directory already exists' }
$null = New-Item -ItemType Directory -Path $checkoutTemp
$owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = [System.Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($owner)
$acl.SetAccessRuleProtection($true, $false)
$rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
    $owner, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $checkoutTemp -AclObject $acl

# Exercise the same file creation and ACL operations as pinned actions/checkout
# using harmless probe content, before any credential enters this directory.
$probe = Join-Path $checkoutTemp 'acl-probe.txt'
try {
    node -e 'require("node:fs").writeFileSync(process.argv[1], "ACL probe\n", {mode: 0o600})' $probe
    if ($LASTEXITCODE -ne 0) { throw 'ACL probe creation failed' }
    $null = & icacls.exe $probe /grant:r "${env:USERDOMAIN}\${env:USERNAME}:F"
    if ($LASTEXITCODE -ne 0) { throw 'ACL probe grant failed' }
    $null = & icacls.exe $probe /inheritance:r
    if ($LASTEXITCODE -ne 0) { throw 'ACL probe inheritance removal failed' }
    $probeAcl = Get-Acl -LiteralPath $probe
    $entries = @($probeAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
    if ($entries.Count -eq 0) { throw 'ACL probe has no access rules' }
    foreach ($entry in $entries) {
        if ($entry.IdentityReference.Value -ne $owner.Value -or $entry.AccessControlType -ne 'Allow') {
            throw 'Checkout auth ACL is not restricted to the runner identity'
        }
    }
    Write-Output 'Checkout auth directory verified: runner identity only.'
} finally {
    if (Test-Path -LiteralPath $probe) { Remove-Item -LiteralPath $probe -Force }
}
