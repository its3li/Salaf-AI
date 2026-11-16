# Creates three public/non-personal synthetic recordings locally, never uses a microphone.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$ffmpeg = python -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'
$directory = Join-Path (Get-Location) 'test-results/cost-benchmark/media'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$samples = @(
    @{ Id = 'learning'; Voice = 'Microsoft David Desktop'; Text = 'A good study routine begins with a small and realistic goal. Choose one topic, remove distractions, and work for twenty minutes. Then close your notes and explain the main idea in your own words. This checks whether you understand the topic rather than simply recognize the words. Take a short break before the next session. Review the lesson tomorrow and again at the end of the week.' },
    @{ Id = 'science'; Voice = 'Microsoft Zira Desktop'; Text = 'Water moves through a repeating cycle. Sunlight warms oceans and lakes, allowing water to evaporate into the air. As the air rises and cools, water vapor condenses into tiny droplets that form clouds. When those droplets grow heavy enough, water falls as rain or snow. Some water enters rivers, while some sinks into the ground. Over time, much of it returns to the ocean, and the cycle continues.' },
    @{ Id = 'budget'; Voice = 'Microsoft David Desktop'; Text = 'A simple budget has three parts: income, essential spending, and savings. First, write down the money you receive each month. Next, list necessary costs such as food, housing, and transportation. Set aside a realistic amount for unexpected expenses. Compare your total spending with your income before making optional purchases. Review your actual transactions each week. The purpose of a budget is to make informed decisions, not to make every month look perfect.' }
)
foreach ($sample in $samples) {
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $synth.SelectVoice($sample.Voice)
    $synth.Rate = 1
    $wav = Join-Path $directory ($sample.Id + '.wav')
    $synth.SetOutputToWaveFile($wav)
    $synth.Speak($sample.Text)
    $synth.Dispose()
    $audio = Join-Path $directory ($sample.Id + '.mp3')
    $silentVideo = Join-Path $directory ($sample.Id + '-silent.mp4')
    $spokenVideo = Join-Path $directory ($sample.Id + '-spoken.mp4')
    # All samples are padded/cut to the same 30-second duration for paired comparisons.
    $duration = '30'
    & $ffmpeg -hide_banner -loglevel error -y -i $wav -af apad -t $duration -c:a libmp3lame -b:a 64k $audio
    & $ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'testsrc2=size=320x240:rate=10' -t $duration -c:v libx264 -pix_fmt yuv420p $silentVideo
    & $ffmpeg -hide_banner -loglevel error -y -i $silentVideo -i $audio -c:v copy -c:a aac -shortest $spokenVideo
    [PSCustomObject]@{ id = $sample.Id; voice = $sample.Voice; durationSec = [double]$duration; text = $sample.Text } |
        ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $directory ($sample.Id + '.json'))
    Write-Output ($sample.Id + ': ' + $duration + ' seconds')
}
