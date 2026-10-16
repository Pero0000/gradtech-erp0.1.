$ErrorActionPreference = 'Stop'

$sourceHelperPath = Join-Path $PSScriptRoot 'Open-LocalFolder.ps1'
if (-not (Test-Path -LiteralPath $sourceHelperPath -PathType Leaf)) {
  throw "Pomocni program nije pronadjen: $sourceHelperPath"
}

$installDirectory = Join-Path $env:LOCALAPPDATA 'TmColor\LocalFolderHelper'
New-Item -Path $installDirectory -ItemType Directory -Force | Out-Null
$helperPath = Join-Path $installDirectory 'Open-LocalFolder.ps1'
Copy-Item -LiteralPath $sourceHelperPath -Destination $helperPath -Force

$protocolPath = 'HKCU:\Software\Classes\tmcolor-folder'
$commandPath = Join-Path $protocolPath 'shell\open\command'
$powershellPath = Join-Path $PSHOME 'powershell.exe'
$command = '"{0}" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{1}" "%1"' -f $powershellPath, $helperPath

New-Item -Path $commandPath -Force | Out-Null
Set-Item -Path $protocolPath -Value 'URL:Tm-color folder helper'
Set-ItemProperty -Path $protocolPath -Name 'URL Protocol' -Value ''
Set-Item -Path $commandPath -Value $command

Write-Host 'Pomocni program za otvaranje mapa instaliran je za ovog Windows korisnika.'
