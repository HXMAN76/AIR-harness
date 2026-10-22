# Voice speaker child for @air/voice. Reads lines on stdin:
#   SAY <base64 UTF-8 text>   queue one utterance
#   STOP                      cancel everything queued or rendering
# Each SAY renders with SAPI to an in-memory 16-bit PCM WAV and answers with one stdout line:
#   WAV <base64 WAV>          the rendered speech (the renderer plays it)
#   DONE                      the utterance was cancelled or produced no audio
# One answer per SAY, in order. Exits when stdin closes.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $synth.SelectVoiceByHints(
    [System.Speech.Synthesis.VoiceGender]::Female,
    [System.Speech.Synthesis.VoiceAge]::Adult,
    0,
    [System.Globalization.CultureInfo]::GetCultureInfo('en-US'))
} catch {
  # Keep the default voice when no voice matches the hints.
}

function Send([string]$line) {
  [Console]::Out.WriteLine($line)
  [Console]::Out.Flush()
}

$queue = New-Object System.Collections.Generic.Queue[string]
$current = $null
$stream = $null
# [Console]::In.ReadLineAsync() runs synchronously; a StreamReader on the raw stream reads in the background.
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
$read = $stdin.ReadLineAsync()
while ($true) {
  if ($read.Wait(20)) {
    $line = $read.Result
    if ($null -eq $line) { break }
    if ($line.StartsWith('SAY ')) {
      $queue.Enqueue([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($line.Substring(4))))
    } elseif ($line -eq 'STOP') {
      while ($queue.Count -gt 0) { [void]$queue.Dequeue(); Send 'DONE' }
      if ($null -ne $current) { $synth.SpeakAsyncCancelAll() }
    }
    $read = $stdin.ReadLineAsync()
  }
  if ($null -ne $current -and $current.IsCompleted) {
    $synth.SetOutputToNull()
    $bytes = $stream.ToArray()
    if ($current.IsCancelled -or $bytes.Length -le 44) { Send 'DONE' } else { Send ('WAV ' + [System.Convert]::ToBase64String($bytes)) }
    $stream.Dispose()
    $current = $null
    $stream = $null
  }
  if ($null -eq $current -and $queue.Count -gt 0) {
    $stream = New-Object System.IO.MemoryStream
    $synth.SetOutputToWaveStream($stream)
    $current = $synth.SpeakAsync($queue.Dequeue())
  }
}
$synth.SpeakAsyncCancelAll()
$synth.Dispose()
