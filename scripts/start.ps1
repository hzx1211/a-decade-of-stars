$ErrorActionPreference = 'Stop'
$projectDirectory = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectDirectory
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '请先安装 Node.js 22.13 或更高版本。' }
if (-not (Test-Path -LiteralPath (Join-Path $projectDirectory 'node_modules'))) {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw '依赖安装失败。' }
}
if (-not (Test-Path -LiteralPath (Join-Path $projectDirectory '.env.local'))) {
  Copy-Item -LiteralPath (Join-Path $projectDirectory '.env.example') -Destination (Join-Path $projectDirectory '.env.local')
}
Write-Host '十余年星途纪念馆：http://127.0.0.1:3000'
npm run dev
exit $LASTEXITCODE
