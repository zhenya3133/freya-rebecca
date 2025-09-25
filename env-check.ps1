# ===== ENV CHECK v2 (Windows PowerShell 5.1 совместим) =====
$ErrorActionPreference = "SilentlyContinue"

function Check-Version([string]$name, [string]$cmd, [string[]]$args) {
  try {
    $out = & $cmd @args 2>$null
    if ($LASTEXITCODE -eq 0 -or $out) {
      if ($out) { $text = ($out -join " ") } else { $text = "OK" }
      Write-Host "[PASS] $name -> $text" -ForegroundColor Green
    } else {
      Write-Host "[FAIL] $name" -ForegroundColor Red
    }
  } catch {
    Write-Host "[FAIL] $name -> $($_.Exception.Message)" -ForegroundColor Red
  }
}

function Show-Path([string]$name, [string]$cmd) {
  $c = Get-Command $cmd -ErrorAction SilentlyContinue
  if ($c) { Write-Host ("{0} path: {1}" -f $name, $c.Source) -ForegroundColor DarkCyan }
  else    { Write-Host ("{0} path: not found" -f $name) -ForegroundColor DarkYellow }
}

Write-Host "=== Проверка окружения (F:) ===" -ForegroundColor Cyan
Set-Location -Path "F:\" -ErrorAction SilentlyContinue

# Node / npm / npx
Check-Version "Node.js" "node" "-v"
Check-Version "npm" "npm" "-v"
Check-Version "npx" "npx" "-v"
Show-Path "Node" "node"

# Git
Check-Version "Git" "git" "--version"
Show-Path "Git" "git"

# Python / pip / py 3.11
Check-Version "Python" "python" "--version"
Check-Version "pip" "pip" "--version"
Check-Version "Python 3.11 (py launcher)" "py" "-3.11 --version"

# C++ Build Tools: cl/msbuild/vcvarsall
$cl = Get-Command cl.exe -ErrorAction SilentlyContinue
if ($cl) { Write-Host "[PASS] cl.exe -> $($cl.Source)" -ForegroundColor Green }
else     { Write-Host "[WARN] cl.exe не найден напрямую" -ForegroundColor Yellow }

$msbuild = Get-Command msbuild.exe -ErrorAction SilentlyContinue
if ($msbuild) { Write-Host "[PASS] MSBuild -> $($msbuild.Source)" -ForegroundColor Green }
else          { Write-Host "[WARN] MSBuild не найден напрямую" -ForegroundColor Yellow }

$vswherePath = "$env:ProgramFiles(x86)\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswherePath) {
  $vsPath = & $vswherePath -latest -products * -requires Microsoft.Component.MSBuild -property installationPath
  if ($vsPath) { Write-Host "[PASS] Visual Studio Installer найден -> $vsPath" -ForegroundColor Green }
  else         { Write-Host "[WARN] vswhere не нашёл MSBuild-компоненты" -ForegroundColor Yellow }
} else {
  Write-Host "[WARN] vswhere.exe не найден (не критично)" -ForegroundColor Yellow
}

$vcvars = Get-ChildItem "C:\Program Files*\Microsoft Visual Studio\" -Recurse -Filter vcvarsall.bat -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
if ($vcvars) { Write-Host "[PASS] vcvarsall.bat -> $vcvars" -ForegroundColor Green }
else         { Write-Host "[WARN] vcvarsall.bat не найден (возможны проблемы со сборкой native модулей)" -ForegroundColor Yellow }

# node-gyp
try {
  $ngv = & npx node-gyp -v 2>$null
  if ($LASTEXITCODE -eq 0) { Write-Host "[PASS] node-gyp -> $ngv" -ForegroundColor Green }
  else { Write-Host "[WARN] node-gyp не запустился (проверьте Python/Build Tools)" -ForegroundColor Yellow }
} catch {
  Write-Host "[WARN] node-gyp не запустился" -ForegroundColor Yellow
}

# VS Code (опционально)
try {
  $codev = & code --version 2>$null
  if ($LASTEXITCODE -eq 0) { Write-Host "[PASS] VS Code ->`n$codev" -ForegroundColor Green }
  else { Write-Host "[INFO] VS Code не найден в PATH (не обязательно)" -ForegroundColor DarkYellow }
} catch { Write-Host "[INFO] VS Code не найден в PATH (не обязательно)" -ForegroundColor DarkYellow }

Write-Host "=== Готово. Смотри PASS/FAIL/WARN выше. ===" -ForegroundColor Cyan
# ===== END CHECK v2 =====
