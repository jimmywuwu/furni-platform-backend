param(
  [string]$ExcelPath,
  [string]$OutputDir
)

if (-not (Test-Path $ExcelPath)) {
  throw "Excel file not found: $ExcelPath"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
  $wb = $excel.Workbooks.Open($ExcelPath)
  $ws = $wb.Worksheets.Item(1)

  $count = 0
  foreach ($shape in $ws.Shapes) {
    try {
      $row = $shape.TopLeftCell.Row
      if ($row -lt 3) { continue }

      $itemNo = [string]$ws.Cells.Item($row, 1).Text
      if ([string]::IsNullOrWhiteSpace($itemNo)) { continue }
      $itemNo = $itemNo.Trim()
      $safeName = ($itemNo -replace '[^a-zA-Z0-9._-]', '_')

      $chartObj = $ws.ChartObjects().Add(0, 0, $shape.Width, $shape.Height)
      $shape.Copy() | Out-Null
      $chartObj.Chart.Paste() | Out-Null

      $outPath = Join-Path $OutputDir ("$safeName.png")
      $chartObj.Chart.Export($outPath, "PNG") | Out-Null
      $chartObj.Delete()

      if (Test-Path $outPath) {
        $count++
      }
    } catch {
      continue
    }
  }

  Write-Output "EXTRACTED_COUNT=$count"
  $wb.Close($false)
} finally {
  if ($wb) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($wb) }
  $excel.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($ws)
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
