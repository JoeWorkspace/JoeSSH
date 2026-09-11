# Run explicitly after closing JoeSSH. This repairs coordination metadata only.
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$AppDataDirectory)

$ErrorActionPreference = 'Stop'
$dataDirectory = (Resolve-Path -LiteralPath $AppDataDirectory).Path
if ((Split-Path -Leaf $dataDirectory) -ne 'dev.atlasterm.joessh') {
    throw 'Select the actual JoeSSH app-data directory ending in dev.atlasterm.joessh.'
}
if ((Get-Item -LiteralPath $dataDirectory).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'The app-data directory must not be a symbolic link or junction.'
}
if (Get-Process -Name 'atlasterm-desktop-shell', 'JoeSSH' -ErrorAction SilentlyContinue) {
    throw 'Close every JoeSSH process before repairing trust metadata.'
}
$mainPath = Join-Path $dataDirectory 'known-hosts.json'
$revisionPath = Join-Path $dataDirectory 'known-hosts-revocation.json'
$lockPath = Join-Path $dataDirectory 'known-hosts.lock'
foreach ($checkedPath in @($mainPath, $revisionPath, $lockPath)) {
    if ((Test-Path -LiteralPath $checkedPath) -and ((Get-Item -LiteralPath $checkedPath).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Trust files and the stable lock must not be symbolic links.'
    }
}
$lockStream = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::ReadWrite)
$locked = $false
$temporaryPath = $null
try {
    $deadline = [DateTime]::UtcNow.AddSeconds(2)
    do {
        try { $lockStream.Lock(0, 1); $locked = $true }
        catch [IO.IOException] { if ([DateTime]::UtcNow -ge $deadline) { throw }; Start-Sleep -Milliseconds 20 }
    } until ($locked)
    # Corrupt/unknown main data requires separate investigation, never a reset.
    $mainText = [IO.File]::ReadAllText($mainPath)
    $mainData = ConvertFrom-Json -InputObject $mainText
    if ($null -eq $mainData -or $mainData -is [array] -or -not $mainText.TrimStart().StartsWith('{')) {
        throw 'The main known-hosts file is not a valid object. No repair was performed.'
    }
    if ($mainData.PSObject.Properties.Name -contains 'hosts') {
        if ($mainData.version -isnot [long] -or $mainData.version -ne 1 -or $mainData.hosts -isnot [PSCustomObject]) { throw 'Unsupported or malformed main known-hosts format.' }
        foreach ($entry in $mainData.hosts.PSObject.Properties) {
            $record = $entry.Value
            foreach ($field in @('key', 'host', 'port', 'fingerprint', 'source')) {
                if ($record.PSObject.Properties.Name -notcontains $field) { throw 'Malformed known-host record.' }
            }
            if ($record.key -cne $entry.Name -or $record.host -isnot [string] -or $record.port -isnot [long] -or
                $record.port -lt 0 -or $record.port -gt 65535 -or $record.fingerprint -isnot [string] -or
                $record.source -cnotin @('legacy', 'tofu', 'confirmed')) { throw 'Malformed known-host record.' }
            foreach ($field in @('first_seen_at_ms', 'last_seen_at_ms')) {
                if ($null -ne $record.$field -and ($record.$field -isnot [long] -or $record.$field -lt 0)) { throw 'Malformed known-host timestamp.' }
            }
        }
    } else {
        foreach ($entry in $mainData.PSObject.Properties) {
            if ($entry.Value -isnot [string]) { throw 'Malformed legacy known-hosts format.' }
        }
    }
    $mainHash = (Get-FileHash -LiteralPath $mainPath -Algorithm SHA256).Hash
    $backupPath = $null
    if (Test-Path -LiteralPath $revisionPath) {
        $revisionText = [IO.File]::ReadAllText($revisionPath)
        $revision = $null
        try { $revision = ConvertFrom-Json -InputObject $revisionText } catch { }
        if (($null -ne $revision -and $revision.PSObject.Properties.Name -contains 'version' -and $revision.version -ne 1) -or
            ($revision -is [PSCustomObject] -and @($revision.PSObject.Properties.Name | Where-Object { $_ -cnotin @('version', 'token') }).Count -ne 0) -or
            ($null -eq $revision -and $revisionText -match '"version"\s*:\s*([2-9]|[1-9][0-9]+)')) {
            throw 'The sidecar may use a newer format. Use its matching application version; do not reset it.'
        }
        $parsedToken = [Guid]::Empty
        if ($revision -is [PSCustomObject] -and $revision.version -is [long] -and $revision.version -eq 1 -and
            $revision.token -is [string] -and [Guid]::TryParse($revision.token, [ref]$parsedToken)) {
            Write-Output 'Coordination metadata is already valid. Nothing changed.'
            return
        }
        $backupPath = $revisionPath + '.backup-' + [Guid]::NewGuid().ToString('D')
        [IO.File]::Copy($revisionPath, $backupPath, $false)
    }
    $token = [Guid]::NewGuid().ToString('D')
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes((@{ version = 1; token = $token } | ConvertTo-Json))
    $temporaryPath = Join-Path $dataDirectory ('.known-hosts-repair-' + [Guid]::NewGuid().ToString('D') + '.tmp')
    $output = [IO.File]::Open($temporaryPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $output.Write($bytes, 0, $bytes.Length); $output.Flush($true) } finally { $output.Dispose() }
    if (Test-Path -LiteralPath $revisionPath) { [IO.File]::Replace($temporaryPath, $revisionPath, [NullString]::Value) }
    else { [IO.File]::Move($temporaryPath, $revisionPath) }
    $temporaryPath = $null
    if ((Get-FileHash -LiteralPath $mainPath -Algorithm SHA256).Hash -ne $mainHash) { throw 'Main file changed unexpectedly. Stop and inspect the app-data directory.' }
    @{ status = 'repaired'; mainSha256 = $mainHash; backup = $backupPath } | ConvertTo-Json
} finally {
    if ($temporaryPath -and (Test-Path -LiteralPath $temporaryPath)) { Remove-Item -LiteralPath $temporaryPath }
    if ($locked) { $lockStream.Unlock(0, 1) }
    $lockStream.Dispose()
}
