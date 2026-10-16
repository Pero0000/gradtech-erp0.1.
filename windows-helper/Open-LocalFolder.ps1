param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Uri
)

Add-Type -AssemblyName System.Windows.Forms

try {
  $requestUri = [System.Uri]::new($Uri)
  if ($requestUri.Scheme -ne 'tmcolor-folder') {
    throw 'Neispravna adresa pomocnog programa.'
  }

  $action = $requestUri.Host
  $siteIdText = [System.Uri]::UnescapeDataString($requestUri.AbsolutePath.Trim('/'))
  [guid]$siteId = [guid]::Empty
  if (-not [guid]::TryParse($siteIdText, [ref]$siteId)) {
    throw 'Identifikator gradilista nije valjan.'
  }
  if ($action -notin @('open', 'select')) {
    throw 'Nepoznata naredba pomocnog programa.'
  }

  $dataDirectory = Join-Path $env:LOCALAPPDATA 'TmColor'
  $dataFile = Join-Path $dataDirectory 'site-folders.json'
  if (-not (Test-Path -LiteralPath $dataDirectory -PathType Container)) {
    New-Item -Path $dataDirectory -ItemType Directory -Force | Out-Null
  }

  $folders = @{}
  if (Test-Path -LiteralPath $dataFile -PathType Leaf) {
    $storedJson = Get-Content -LiteralPath $dataFile -Raw
    if (-not [string]::IsNullOrWhiteSpace($storedJson)) {
      $storedFolders = ConvertFrom-Json -InputObject $storedJson -ErrorAction Stop
      foreach ($property in $storedFolders.PSObject.Properties) {
        if ($property.Value -is [string]) {
          $folders[$property.Name] = $property.Value
        }
      }
    }
  }

  $siteKey = $siteId.ToString('D')
  $folderPath = $folders[$siteKey]
  $folderExists = -not [string]::IsNullOrWhiteSpace($folderPath) -and (Test-Path -LiteralPath $folderPath -PathType Container)

  if ($action -eq 'select' -or -not $folderExists) {
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Odaberi mapu ovog gradilista.'
    $dialog.ShowNewFolderButton = $false
    if ($folderExists) {
      $dialog.SelectedPath = $folderPath
    }

    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
      return
    }

    $folderPath = $dialog.SelectedPath
    if (-not (Test-Path -LiteralPath $folderPath -PathType Container)) {
      throw 'Odabrana mapa vise nije dostupna.'
    }

    $folders[$siteKey] = $folderPath
    ConvertTo-Json -InputObject $folders -Depth 3 |
      Set-Content -LiteralPath $dataFile -Encoding UTF8
  }

  if ($action -eq 'open') {
    Start-Process -FilePath (Join-Path $env:WINDIR 'explorer.exe') -ArgumentList ('"{0}"' -f $folderPath)
  }
}
catch {
  [System.Windows.Forms.MessageBox]::Show(
    $_.Exception.Message,
    'Tm-color - lokalna mapa',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
  exit 1
}
