# Voice speaker child for @air/voice. Reads lines on stdin:
#   SAY <base64 UTF-8 text>   queue one utterance
#   STOP                      cancel everything queued or playing
# Writes DONE on stdout once per utterance when it finishes or is cancelled.
# Exits when stdin closes.
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
$synth.SetOutputToDefaultAudioDevice()

$prompts = New-Object System.Collections.Generic.List[object]
# [Console]::In.ReadLineAsync() runs synchronously; a StreamReader on the raw stream reads in the background.
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
$read = $stdin.ReadLineAsync()
while ($true) {
  if ($read.Wait(50)) {
    $line = $read.Result
    if ($null -eq $line) { break }
    if ($line.StartsWith('SAY ')) {
      $text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($line.Substring(4)))
      $prompts.Add($synth.SpeakAsync($text))
    } elseif ($line -eq 'STOP') {
      $synth.SpeakAsyncCancelAll()
    }
    $read = $stdin.ReadLineAsync()
  }
  while ($prompts.Count -gt 0 -and $prompts[0].IsCompleted) {
    $prompts.RemoveAt(0)
    [Console]::Out.WriteLine('DONE')
    [Console]::Out.Flush()
  }
}
$synth.SpeakAsyncCancelAll()
$synth.Dispose()
