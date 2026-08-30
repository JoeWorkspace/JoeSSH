// A Node child can inherit PowerShell 7's PSModulePath when launching Windows
// PowerShell 5.1. Keep signature checks on the modules shipped with that host:
// importing the 7.x Security module into 5.1 can fail with duplicate TypeData.
// These assignments affect only the spawned PowerShell process.
export const WINDOWS_AUTHENTICODE_SETUP = [
  "$ErrorActionPreference = 'Stop';",
  "$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules');",
  "Import-Module ([IO.Path]::Combine($PSHOME, 'Modules', 'Microsoft.PowerShell.Security', 'Microsoft.PowerShell.Security.psd1')) -ErrorAction Stop;",
].join(" ");
