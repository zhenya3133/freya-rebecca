<# ======================================================================
 Sync-Memory.ps1
 Копирует записи памяти между слотами для заданного ns.
 Примеры:
   # prod ← staging
   .\Sync-Memory.ps1 -Ns "rebecca/army/agents" -From staging -To prod

   # staging ← prod
   .\Sync-Memory.ps1 -Ns "rebecca/army/agents" -From prod -To staging

 Параметры:
   -BaseUrl   базовый URL (по умолчанию http://localhost:3000)
   -Ns        namespace (обязателен)
   -From      staging|prod (источник)
   -To        staging|prod (приёмник)
   -Limit     сколько тянуть за раз (дефолт 1000)
====================================================================== #>

param(
  [string]$BaseUrl = "http://localhost:3000",
  [Parameter(Mandatory=$true)][string]$Ns,
  [ValidateSet('staging','prod')][string]$From = 'staging',
  [ValidateSet('staging','prod')][string]$To   = 'prod',
  [int]$Limit = 1000
)

if ($From -eq $To) { Write-Host "From и To не должны совпадать." -ForegroundColor Yellow; exit 1 }

function Get-FullItems([string]$ns,[string]$slot,[int]$limit){
  $all = @()
  $offset = 0
  while ($true) {
    $url = "$BaseUrl/api/memory/list?ns=$( [uri]::EscapeDataString($ns) )&slot=$slot&full=1&limit=$limit&offset=$offset&order=asc"
    $resp = Invoke-RestMethod $url
    if (-not $resp.ok) { throw "list failed: $($resp.error)" }
    $all += $resp.items
    if ($null -eq $resp.nextOffset) { break }
    $offset = $resp.nextOffset
  }
  return $all
}

Write-Host "Reading from: $Ns [$From] ..." -ForegroundColor Cyan
$items = Get-FullItems -ns $Ns -slot $From -limit $Limit
Write-Host ("Found {0} items" -f $items.Count)

if ($items.Count -eq 0) { Write-Host "Нечего копировать." -ForegroundColor Yellow; exit 0 }

# Если это наши agent-spec, можно ускоренно через /api/agents/save (bulk).
# Иначе — универсально через /api/memory/upsert построчно.
# Попробуем распознать agent-spec (name/purpose).
$agents = @()
foreach($it in $items){
  $obj = $it.content
  if ($obj -is [string]) { $obj = $obj | ConvertFrom-Json }
  if ($obj -and $obj.name -and $obj.purpose) {
    $agents += [pscustomobject]@{
      name    = $obj.name
      purpose = $obj.purpose
      inputs  = $obj.inputs
      outputs = $obj.outputs
    }
  }
}

if ($agents.Count -gt 0 -and $agents.Count -eq $items.Count) {
  Write-Host "Looks like AgentSpec[] — saving via /api/agents/save (bulk) → $To" -ForegroundColor Green
  $payload = $agents | ConvertTo-Json -Depth 12
  $resp = Invoke-RestMethod -Method Post `
    -Uri "$BaseUrl/api/agents/save?ns=$Ns&slot=$To" `
    -Body ([Text.Encoding]::UTF8.GetBytes($payload)) `
    -ContentType 'application/json'
  $resp
} else {
  Write-Host "Generic content — saving via /api/memory/upsert (per-item) → $To" -ForegroundColor Green
  $ok = 0
  foreach($it in $items){
    $contentJson = if ($it.content -is [string]) { $it.content } else { ($it.content | ConvertTo-Json -Depth 32) }
    $body = @{
      ns = $Ns
      slot = $To
      kind = $it.kind
      content = $contentJson
      metadata = $it.metadata
    } | ConvertTo-Json -Depth 32

    try{
      $r = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/memory/upsert" `
        -Body ([Text.Encoding]::UTF8.GetBytes($body)) `
        -ContentType 'application/json'
      if ($r.ok) { $ok++ }
      Start-Sleep -Milliseconds 200  # чуть притормозим, чтобы не словить таймауты/квоты
    } catch {
      Write-Host "fail: $($_.Exception.Message)" -ForegroundColor Yellow
    }
  }
  Write-Host ("Saved: {0} / {1}" -f $ok, $items.Count) -ForegroundColor Cyan
}
