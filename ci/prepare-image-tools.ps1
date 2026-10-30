$ErrorActionPreference = 'Stop'
$imageToolsDir = Join-Path $env:RUNNER_TEMP 'image-verification-tools'
$imageArchive = Join-Path $env:RUNNER_TEMP 'image-verification-tools.7z'
$imageUri = 'https://github.com/ImageMagick/ImageMagick/releases/download/7.1.2-34/ImageMagick-7.1.2-34-portable-Q16-x64.7z'
$expectedHash = '52cc6a441c7884f5ff4274b410c9b90c4b7d54245dcdf4d32988bb4e4df4e5d1'
Invoke-WebRequest -Uri $imageUri -OutFile $imageArchive
if ((Get-FileHash -Algorithm SHA256 $imageArchive).Hash.ToLowerInvariant() -ne $expectedHash) {
    throw 'Image verification tool digest mismatch'
}
New-Item -ItemType Directory -Path $imageToolsDir -Force | Out-Null
& 7z x -y "-o$imageToolsDir" $imageArchive | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $imageToolsDir 'magick.exe'))) {
    throw 'Image verification tool extraction failed'
}
& (Join-Path $imageToolsDir 'magick.exe') -version
if ($LASTEXITCODE -ne 0) { throw 'Image verification tool failed to start' }
