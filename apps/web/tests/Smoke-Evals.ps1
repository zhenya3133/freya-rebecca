# apps/web/tests/Smoke-Evals.ps1
param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$Ns      = "rebecca/army/agents",
  [string]$AdminKey # опционально, если не передан — возьмём из .env.local
)

$ErrorActionPreference = "Stop"

function _json($s) { try { $s | ConvertTo-Json -Depth 100 } catch { $s } }
function _read-env-local([string]$key) {
  $envPath = Join-Path (Split-Path -Parent $PSCommandPath) "..\..\..\.env.local"
  if (Test-Path $envPath) {
    $line = (Get-Content $envPath) | Where-Object { $_ -match "^$key=" }
    if ($line) { return ($line -replace "^$key=","").Trim() }
  }
  return $null
}

if (-not $AdminKey) { $AdminKey = _read-env-local "ADMIN_KEY" }

Write-Host "== Smoke start ==" -ForegroundColor Cyan
Write-Host ("BaseUrl : {0}" -f $BaseUrl)
Write-Host ("Ns      : {0}" -f $Ns)
Write-Host ("AdminKey: {0}" -f ($(if ($AdminKey) {'present'} else {'<none>'})))

$ok = 0; $fail = 0

function _step([string]$title, [scriptblock]$body) {
  Write-Host ""
  Write-Host ">> $title" -ForegroundColor Yellow
  try {
    & $body
    $script:ok++
    Write-Host "OK" -ForegroundColor Green
  }
  catch {
    $script:fail++
    Write-Host ("FAIL: {0}" -f $_.Exception.Message) -ForegroundColor Red
    if ($_.Exception.ErrorRecord.InvocationInfo.Line) {
      Write-Host ($_.Exception.ErrorRecord.InvocationInfo.Line.Trim()) -ForegroundColor DarkGray
    }
    if ($_.Exception.Response -and ($_.Exception.Response -is [System.Net.HttpWebResponse])) {
      try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $respBody = $reader.ReadToEnd()
        if ($respBody) {
          Write-Host "— response body —" -ForegroundColor DarkGray
          Write-Host $respBody
        }
      } catch {}
    }
  }
}

# 1) /api/db-ping
_step "/api/db-ping" {
  $pong = Invoke-RestMethod "$BaseUrl/api/db-ping" -TimeoutSec 20
  if (-not $pong.ok) { throw "db-ping returned ok=false" }
}

# 2) /api/memory/list (public) — ОБЯЗАТЕЛЬНО с ns
_step "/api/memory/list (public)" {
  $qs = "ns={0}&limit=1" -f ([uri]::EscapeDataString($Ns))
  $list = Invoke-RestMethod "$BaseUrl/api/memory/list?$qs" -TimeoutSec 30
  if (-not $list.ok) { throw "list returned ok=false: $(_json $list)" }
}

# 3) /api/admin/sql (защищённый)
_step "/api/admin/sql (protected)" {
  if (-not $AdminKey) { throw "ADMIN_KEY is empty (set param -AdminKey or .env.local)" }
  $H = @{ 'Content-Type'='application/json'; 'X-Admin-Key'=$AdminKey }
  $B = @{ sql = "SELECT 1 as one" } | ConvertTo-Json
  $resp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/admin/sql" -Headers $H -Body $B -TimeoutSec 30
  if (-not $resp.ok) { throw "admin/sql returned ok=false: $(_json $resp)" }
}

# 4) /api/memory/delete dry-run (защищённый)
_step "/api/memory/delete (dry-run)" {
  if (-not $AdminKey) { throw "ADMIN_KEY is empty (set param -AdminKey or .env.local)" }
  $H = @{ 'Content-Type'='application/json'; 'X-Admin-Key'=$AdminKey }
  $B = @{ ns=$Ns; slot='prod'; dryRun=$true; limit=1 } | ConvertTo-Json
  $resp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/memory/delete" -Headers $H -Body $B -TimeoutSec 30
  if (-not $resp.ok) { throw "delete dry-run returned ok=false: $(_json $resp)" }
}

Write-Host ""
Write-Host ("== Smoke summary: OK {0} / FAIL {1} ==" -f $ok, $fail) -ForegroundColor Cyan
if ($fail -gt 0) { exit 1 } else { exit 0 }
