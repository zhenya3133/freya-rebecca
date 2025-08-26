<# ======================================================================
 Run-Rag.ps1
 one-shot: seed(clearAll) → diag → ask → answer → (опц.) save agents
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
  [ValidateSet('qa','json','code','list','spec')]
  [string]$Profile   = "qa",
  [string]$CodeLang  = "typescript",   # для profile=code

  # диагностика
  [int]   $DiagLimit = 20,

  # --- Новое: сохранение массива агентов в БД через /api/agents/save ---
  [switch]$SaveAgents,                        # включает сохранение
  [string]$AgentsJsonPath = ".\answer.json"   # путь куда сохранить payload перед отправкой
)

# --- консоль в UTF-8 (чтобы кириллица не билась) ---
[Console]::InputEncoding  = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ProgressPreference = 'SilentlyContinue'

function Write-Head($t){ Write-Host "`n=== $t ===" -ForegroundColor Cyan }

# Универсальный вывод HTTP-ошибки (работает в PS7)
function Show-HttpError {
  param(
    [string]$Where,
    $Ex,
    [string]$Url
  )
  $resp = $Ex.Exception.Response
  $code = $null
  $body = $null

  if ($null -ne $resp) {
    if ($resp -is [System.Net.Http.HttpResponseMessage]) {
      $code = [int]$resp.StatusCode
      try { $body = $resp.Content.ReadAsStringAsync().Result } catch {}
    } elseif ($resp -is [System.Net.WebResponse]) {
      try { $code = [int]$resp.StatusCode } catch {}
      try {
        $stream = $resp.GetResponseStream()
        if ($stream) {
          $reader = New-Object IO.StreamReader($stream)
          $body   = $reader.ReadToEnd()
        }
      } catch {}
    }
  }
  if (-not $body) {
    if ($Ex.ErrorDetails -and $Ex.ErrorDetails.Message) { $body = $Ex.ErrorDetails.Message }
    else { $body = $Ex | Out-String }
  }

  Write-Host ("HTTP error from`n  {0}`nStatus: {1}`n{2}" -f $Url, $code, $body) -ForegroundColor Red
}

# Преобразование объекта в компактную JSON-строку
function To-JsonString($obj){
  if ($obj -is [string]) { return $obj }
  return ($obj | ConvertTo-Json -Depth 12 -Compress)
}

# POST JSON (строкой, без charset/байтов)
function Invoke-JsonPost($url, $obj){
  $json = To-JsonString $obj
  try{
    return Invoke-RestMethod -Uri $url -Method POST -ContentType "application/json" -Body $json
  } catch {
    Show-HttpError -Where "Invoke-JsonPost" -Ex $_ -Url $url
    throw
  }
}

function Get-Diag($base,$ns,$slot,$limit){
  $nsEnc = [uri]::EscapeDataString($ns)
  Invoke-RestMethod "$base/api/diag/chunks?ns=$nsEnc&slot=$slot&limit=$limit"
}

# --- Новое: POST /api/agents/save ---
function Invoke-AgentsSave {
  param([string]$JsonPath)

  if (-not (Test-Path $JsonPath)) {
    Write-Host "Agents JSON not found: $JsonPath" -ForegroundColor Red
    return
  }
  $json = Get-Content -Raw -Encoding UTF8 $JsonPath

  # простая проверка что это массив JSON
  if ($json.Trim().Substring(0,1) -ne "[") {
    Write-Host "Ожидался JSON-массив AgentSpec[], получили не-массив. Проверь профиль и payload." -ForegroundColor Yellow
  }

  $url = "$BaseUrl/api/agents/save"
  try {
    $resp = Invoke-RestMethod -Method Post -Uri $url -Body $json -ContentType "application/json"
    if ($resp.ok) {
      Write-Host ("Saved agents: {0}" -f ($resp.saved)) -ForegroundColor Green
    } else {
      Write-Host ("Save failed: {0}" -f ($resp.error)) -ForegroundColor Red
    }
  } catch {
    Show-HttpError -Where "Invoke-AgentsSave" -Ex $_ -Url $url
    throw
  }
}

# --- быстрый чек, что dev-сервер слушает 3000 ---
Write-Head "Проверка dev-сервера"
$ok = (Test-NetConnection localhost -Port 3000).TcpTestSucceeded
if(-not $ok -and $BaseUrl -like "http://localhost*"){
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

# --- Новое: сохранение агентов ---
if ($SaveAgents) {
  Write-Head "Сохранение агентных спецификаций"
  if ($Profile -ne 'json') {
    Write-Host "Для SaveAgents профиль должен быть 'json' (получаем AgentSpec[])." -ForegroundColor Yellow
  } elseif (-not $ansResp.payload) {
    Write-Host "payload отсутствует в ответе сервера (нет, пустой или ошибка парсинга)." -ForegroundColor Red
  } else {
    # Получаем JSON-текст
    $jsonOut = if ($ansResp.payload -is [string]) {
      $ansResp.payload
    } else {
      $ansResp.payload | ConvertTo-Json -Depth 12 -Compress
    }

    # Сохраняем в файл
    try {
      Set-Content -Path $AgentsJsonPath -Value $jsonOut -Encoding UTF8
      Write-Host ("Payload сохранён: {0}" -f (Resolve-Path $AgentsJsonPath)) -ForegroundColor Green
    } catch {
      Write-Host "Не удалось сохранить payload в файл: $AgentsJsonPath" -ForegroundColor Red
      throw
    }

    # Отправляем на /api/agents/save
    Invoke-AgentsSave -JsonPath $AgentsJsonPath
  }
}

"`n-- DEBUG (модели/попытки) --`n"
$ansResp.debug | Format-Table model, mode, len, where, err -Auto
