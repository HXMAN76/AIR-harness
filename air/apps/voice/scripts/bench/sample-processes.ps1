# Sample CPU time and working set of a process and all its descendants once per interval; one JSON line per process per sample.
# Usage: powershell -File sample-processes.ps1 -RootPid 1234 -IntervalMs 1000
# The line carries a role (host, listener, tts, dsh-runtime, electron-*, ...), never a command line.
param([int]$RootPid, [int]$IntervalMs = 1000)
$ErrorActionPreference = 'SilentlyContinue'

function Role([string]$name, [string]$cmd, [int]$id) {
  if ($id -eq $RootPid) { return 'host' }
  if ($cmd -match 'listener-worker') { return 'listener' }
  if ($cmd -match 'tts-worker') { return 'tts' }
  if ($cmd -match '--profile web') { return 'dsh-web' }
  if ($cmd -match '--profile sdk' -or $cmd -match 'cli[\\/]lib[\\/]bin\.js') { return 'dsh-runtime' }
  if ($name -eq 'electron.exe') {
    if ($cmd -match '--type=renderer') { return 'electron-renderer' }
    if ($cmd -match '--type=gpu-process') { return 'electron-gpu' }
    if ($cmd -match '--type=utility') { return 'electron-utility' }
    return 'electron-main'
  }
  if ($name -eq 'powershell.exe') { return 'powershell' }
  if ($name -eq 'node.exe') { return 'node-other' }
  return "other:$name"
}

while ($true) {
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine)
  $set = @{}
  $set[$RootPid] = $true
  do {
    $grew = $false
    foreach ($p in $all) {
      if ($set.ContainsKey([int]$p.ParentProcessId) -and -not $set.ContainsKey([int]$p.ProcessId) -and $p.ProcessId -ne $PID) {
        $set[[int]$p.ProcessId] = $true
        $grew = $true
      }
    }
  } while ($grew)
  foreach ($p in $all) {
    $id = [int]$p.ProcessId
    if (-not $set.ContainsKey($id) -or $id -eq $PID) { continue }
    if ($p.CommandLine -match 'sample-processes') { continue }
    $proc = [System.Diagnostics.Process]::GetProcessById($id)
    if ($null -eq $proc) { continue }
    $line = [ordered]@{
      t = $now
      pid = $id
      role = (Role $p.Name ([string]$p.CommandLine) $id)
      cpuMs = [math]::Round($proc.TotalProcessorTime.TotalMilliseconds, 1)
      rssBytes = $proc.WorkingSet64
    }
    [Console]::Out.WriteLine(($line | ConvertTo-Json -Compress))
  }
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds $IntervalMs
}
