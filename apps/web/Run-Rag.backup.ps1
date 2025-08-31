<# ======================================================================
 Run-Rag.ps1
 one-shot: seed(clearAll) → diag → ask → answer
 PowerShell 7.x, UTF-8. Запускай из папки apps/web.
====================================================================== #>

param(
  # базовые настройки
  [string]$BaseUrl   = "http://localhost:3000",
  [string]$Ns        = "rebecca/core",
  [string]$Slot      = "staging",

  # seed
  [string]$SeedPath  = "",     # если указан — возьмём docs из этого JSON
  [switch]$NoSeed,             # пропустить стадию seed

  # retriever / ask / answer
  [string]$Query     = "Кто такая Rebecca и какие у нас гейты качества?",
  [int]   $TopK      = 10,
  [double]$Lambda    = 0.7,
  [double]$MinScore  = 0.18,
  [int]   $MaxTokens = 450,
  [string]$Model     = "gpt-4o-mini",

  # профиль ответа (см. /api/rag/answer)
  [string]$Profile   = "qa",           # qa | json | code | list | spec
  [string]$CodeLang  = "typescript",   # для profile=code

  # диагностика
  [int]   $DiagLimit = 20
)

# --- консоль в UTF-8 (чтобы кириллица не билась) ---
[Console]::InputEncoding  = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ProgressPreference = 'SilentlyContinue'

function Write-Head($t){ Write-Host "`n=== $t ===" -ForegroundColor Cyan }

function Invoke-JsonPost($url, $obj){
  $json  = if ($obj -is [string]) { $obj } else { $obj | ConvertTo-Json -Depth 12 }
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  try{
    return Invoke-RestMethod $url -Method POST -ContentType "application/json; charset=utf-8" -Body $bytes
  } catch {
    if ($_.Exception.Response) {
      $reader = New-Object IO.StreamReader ($_.Exception.Response.GetResponseStream())
      $body   = $reader.ReadToEnd()
      Write-Host ("HTTP error from `n  {0}`n{1}" -f $url,$body) -ForegroundColor Red
    } else {
      Write-Host $_ -ForegroundColor Red
    }
    throw
  }
}

function Get-Diag($base,$ns,$slot,$limit){
  $nsEnc = [uri]::EscapeDataString($ns)
  Invoke-RestMethod "$base/api/diag/chunks?ns=$nsEnc&slot=$slot&limit=$limit"
}

# --- быстрый чек, что dev-сервер слушает 3000 ---
Write-Head "Проверка dev-сервера"
$ok = (Test-NetConnection localhost -Port 3000).TcpTestSucceeded
if(-not $ok){
  Write-Host "Порт 3000 не слушается. Запусти:  npm run dev" -ForegroundColor Yellow
  return
}

# --- SEED (optional) ---
if(-not $NoSeed){
  Write-Head "Seed (clearAll=true) → $Ns"
  if($SeedPath -and (Test-Path $SeedPath)){
    # читаем файл, подмешиваем ns/clearAll
    $fileJson = Get-Content $SeedPath -Raw -Encoding UTF8
    try {
      $obj = $fileJson | ConvertFrom-Json
      $obj.ns       = $Ns
      $obj.clearAll = $true
      $respSeed = Invoke-JsonPost "$BaseUrl/api/ingest/seed" $obj
    } catch {
      # файл не JSON? используем как есть
      $respSeed = Invoke-JsonPost "$BaseUrl/api/ingest/seed" $fileJson
    }
  } else {
    # дефолтный минимальный набор документов
    $respSeed = Invoke-JsonPost "$BaseUrl/api/ingest/seed" @{
      ns       = $Ns
      clearAll = $true
      docs     = @(
        @{ title = "Rebecca.md"; content = "# Rebecca`nRAG-конвейер второго поколения для наших задач." },
        @{ title = "Roles.md";   content = "# Роли`nFreya — стратегия/оркестрация.`nRebecca — инженерная фабрика и RAG." },
        @{ title = "Gates.md";   content = "# Гейты качества`nMMR, minScore, recency, evals-ворота." }
      )
    }
  }
  $respSeed | Format-List ns, corpusId, added, slot, cleared, clearedAll
} else {
  Write-Head "Seed пропущен (NoSeed)"
}

# --- DIAG ---
Write-Head "Диагностика чанков ($Ns / $Slot)"
$diag = Get-Diag $BaseUrl $Ns $Slot $DiagLimit
$diag

# --- ASK ---
Write-Head "Кандидаты (ask)"
$askResp = Invoke-JsonPost "$BaseUrl/api/rag/ask" @{
  query    = $Query
  ns       = $Ns
  topK     = $TopK
  lambda   = $Lambda
  minScore = $MinScore
}
$askResp.matches | Format-Table score, ns, snippet -Auto

# --- ANSWER ---
Write-Head "Ответ LLM (answer)"
$ansResp = Invoke-JsonPost "$BaseUrl/api/rag/answer" @{
  query     = $Query
  ns        = $Ns
  topK      = $TopK
  minScore  = $MinScore
  maxTokens = $MaxTokens
  model     = $Model
  profile   = $Profile
  codeLang  = $CodeLang
  debug     = $true
}

"model: $($ansResp.model)"
"mode:  $($ansResp.mode)"
"prof:  $($ansResp.profile)"

"`n-- ANSWER --`n$($ansResp.answer)"
"`n-- SOURCES --`n"
$ansResp.sources | Format-Table n, score, path, url -Auto

# Если profile=json — покажем распарсенный payload (если сервер его вернул)
if ($ansResp.payload) {
  Write-Host "`n-- PAYLOAD (parsed JSON) --" -ForegroundColor Green
  if ($ansResp.payload -is [System.Array]) {
    $ansResp.payload | Format-Table -Auto | Out-Host
  } else {
    $ansResp.payload | ConvertTo-Json -Depth 8 | Out-Host
  }
}
if ($ansResp.payloadParseError) {
  Write-Host "`n(payloadParseError): $($ansResp.payloadParseError)" -ForegroundColor Yellow
}

"`n-- DEBUG (модели/попытки) --`n"
$ansResp.debug | Format-Table model, mode, len, where, err -Auto
