$file = 'd:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\components\monitor\Charts.tsx'
$content = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)
$startMarker = '// ===== sample 数据解析'
$endMarker = '// ===== 实时数据格式化'
$startIdx = $content.IndexOf($startMarker)
$endIdx = $content.IndexOf($endMarker)
if ($startIdx -ge 0 -and $endIdx -gt $startIdx) {
    $newContent = $content.Substring(0, $startIdx) + $content.Substring($endIdx)
    [System.IO.File]::WriteAllText($file, $newContent, [System.Text.Encoding]::UTF8)
    Write-Host 'Removed sample data block successfully'
} else {
    Write-Host "Markers not found. startIdx=$startIdx, endIdx=$endIdx"
}
