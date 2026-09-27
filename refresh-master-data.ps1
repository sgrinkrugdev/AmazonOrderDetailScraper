param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot 'master-data.config.local.json'),
  [string]$OutputPath = (Join-Path $PSScriptRoot 'master-data.local.js')
)

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$csvPath = $config.masterCsvPath
if (-not $csvPath) { throw "masterCsvPath is missing from $ConfigPath" }
if (-not (Test-Path -LiteralPath $csvPath)) { throw "Master CSV not found: $csvPath" }

$rows = Import-Csv -LiteralPath $csvPath | ForEach-Object {
  $order = [string]$_.'Order number'
  $amount = [string]$_.'Order amount'
  $date = [string]$_.Date
  if ($order -and $amount -and $date) {
    [pscustomobject]@{ amount = $amount; order = $order; date = $date }
  }
}

$json = $rows | ConvertTo-Json -Compress
$source = $csvPath -replace '\\', '/'
Set-Content -LiteralPath $OutputPath -Encoding UTF8 -Value "// Local snapshot of $source. Excluded from Git.`nglobalThis.amazonMasterRows = $json;"
Write-Host "Wrote $($rows.Count) master rows to $OutputPath"