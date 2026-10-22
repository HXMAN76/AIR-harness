# Render phrases with one Windows SAPI voice to 16 kHz mono 16-bit WAV files.
# Usage: powershell -File render-sapi.ps1 -Voice "Microsoft David Desktop" -List phrases.json
# phrases.json: [{ "path": "C:/x/a.wav", "text": "open notepad", "ssml": "<speak>...</speak>" (optional) }, ...]
param([string]$Voice, [string]$List)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice($Voice)
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$items = Get-Content -Raw -Path $List | ConvertFrom-Json
foreach ($item in $items) {
  $synth.SetOutputToWaveFile($item.path, $format)
  if ($item.ssml) { $synth.SpeakSsml($item.ssml) } else { $synth.Speak($item.text) }
  $synth.SetOutputToNull()
}
$synth.Dispose()
