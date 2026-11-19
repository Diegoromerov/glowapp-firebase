[CmdletBinding()]
param(
    [ValidateRange(1, 20)]
    [int]$Requests = 5,

    [ValidateRange(1, 5)]
    [int]$PauseSeconds = 1
)

$ErrorActionPreference = 'Stop'
$target = 'https://glowapp-api-staging-staging.up.railway.app/api/providers'
$audienceHeader = 'X-App-Audience: client'

if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) {
    throw 'curl.exe is required; no request was sent.'
}

$samples = [System.Collections.Generic.List[object]]::new()
Write-Output "Read-only staging probe: $Requests sequential GETs, ${PauseSeconds}s pause, one request at a time."

for ($index = 1; $index -le $Requests; $index += 1) {
    $raw = & curl.exe --silent --show-error --connect-timeout 5 --max-time 15 `
        --header $audienceHeader --output NUL `
        --write-out 'HTTP=%{http_code} RTT_S=%{time_total} BYTES=%{size_download}' `
        $target 2>&1
    $curlExit = $LASTEXITCODE
    $match = [regex]::Match(($raw -join ' '), 'HTTP=(\d+) RTT_S=([\d.]+) BYTES=(\d+)')

    if ($curlExit -ne 0 -or -not $match.Success) {
        throw "Request $index failed at the transport layer (curl exit $curlExit); stopping the probe."
    }

    $status = [int]$match.Groups[1].Value
    $elapsedMs = [math]::Round(
        [double]::Parse($match.Groups[2].Value, [cultureinfo]::InvariantCulture) * 1000,
        1
    )
    $elapsedText = $elapsedMs.ToString('0.0', [cultureinfo]::InvariantCulture)
    $bytes = [int]$match.Groups[3].Value
    $samples.Add([pscustomobject]@{ Request = $index; Status = $status; RttMs = $elapsedMs; Bytes = $bytes })
    Write-Output "Request $index/$Requests HTTP $status, RTT ${elapsedText}ms, $bytes bytes."

    if ($status -ne 200) {
        throw "Request $index returned HTTP $status; stopping the probe."
    }
    if ($index -lt $Requests) { Start-Sleep -Seconds $PauseSeconds }
}

$sorted = @($samples | ForEach-Object { $_.RttMs } | Sort-Object)
$middle = [int][math]::Floor($sorted.Count / 2)
$median = if ($sorted.Count % 2) { $sorted[$middle] } else { ($sorted[$middle - 1] + $sorted[$middle]) / 2 }
$minText = $sorted[0].ToString('0.0', [cultureinfo]::InvariantCulture)
$medianText = $median.ToString('0.0', [cultureinfo]::InvariantCulture)
$maxText = $sorted[-1].ToString('0.0', [cultureinfo]::InvariantCulture)
Write-Output "SUMMARY success=$($samples.Count)/$Requests min_ms=$minText median_ms=$medianText max_ms=$maxText response_bytes=$(($samples.Bytes | Sort-Object -Unique) -join ',')"

