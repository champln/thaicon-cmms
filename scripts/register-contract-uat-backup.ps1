param(
    [Parameter(Mandatory)][string]$ConfigPath
)

$ErrorActionPreference = 'Stop'
$configuredPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$script = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'backup-contract-uat.mjs')).Path
$node = (Get-Command node.exe).Source
$runner = Join-Path (Split-Path -Parent $configuredPath) 'scheduled-backup.ps1'
$log = Join-Path (Split-Path -Parent $configuredPath) 'last-run.log'

function Quote-Literal([string]$Value) {
    "'" + $Value.Replace("'", "''") + "'"
}

$code = @"
Set-Location -LiteralPath $(Quote-Literal $PSScriptRoot)
& $(Quote-Literal $node) $(Quote-Literal $script) $(Quote-Literal $configuredPath) *> $(Quote-Literal $log)
exit `$LASTEXITCODE
"@
[IO.File]::WriteAllText($runner, $code)

$zone = [TimeZoneInfo]::FindSystemTimeZoneById('SE Asia Standard Time')
$now = [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $zone)
$next = $now.Date.AddHours(2)
if ($next -le $now) { $next = $next.AddDays(1) }
$at = [TimeZoneInfo]::ConvertTimeToUtc($next, $zone).ToLocalTime()
$trigger = New-ScheduledTaskTrigger -Daily -At $at
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $runner + '"')
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Thaicon Contract UAT Backup' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force
