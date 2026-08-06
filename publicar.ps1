# =====================================================================
#  MURAL AZIME - Publicar no site
#  1) prepara as fotos (copias leves)
#  2) envia para o GitHub
#  3) o Railway percebe o envio e atualiza o site sozinho em ~1 minuto
#
#  Use isto quando adicionar/trocar fotos na pasta FOTOS.
# =====================================================================
[CmdletBinding()]
param(
  [string]$Site = 'https://fotos-production-d497.up.railway.app'
)

$Aqui = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
Set-Location $Aqui

# ---------- 1) fotos ----------
& (Join-Path $Aqui 'atualizar-fotos.ps1')

# ---------- 2) GitHub ----------
Write-Host ''
Write-Host '  Enviando para o GitHub...' -ForegroundColor Cyan

git add -A | Out-Null

$mudou = git status --porcelain
if (-not $mudou) {
  Write-Host '  Nada mudou desde a ultima publicacao - o site ja esta atualizado.' -ForegroundColor Green
  Write-Host "  $Site" -ForegroundColor Green
  Write-Host ''
  return
}

$qt = ($mudou | Measure-Object).Count
$msg = "Atualiza fotos do mural ({0} arquivos, {1})" -f $qt, (Get-Date -Format 'dd/MM/yyyy HH:mm')

git commit -q -m $msg
if (-not $?) { Write-Host '  Falha ao criar o commit.' -ForegroundColor Red; return }

git push origin main
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host '  O envio falhou.' -ForegroundColor Red
  Write-Host '  Se pediu login e voce fechou a janela, rode de novo e faca o login do GitHub.' -ForegroundColor Yellow
  Write-Host '  O commit ficou salvo aqui - nada foi perdido.' -ForegroundColor DarkGray
  Write-Host ''
  return
}

# ---------- 3) pronto ----------
Write-Host ''
Write-Host '  PUBLICADO' -ForegroundColor Green
Write-Host '  ------------------------------------------------'
Write-Host "  $Site"
Write-Host '  O site se atualiza em ~1 minuto (o Railway esta reconstruindo).' -ForegroundColor DarkGray
Write-Host '  No tablet, e so recarregar a pagina depois disso.' -ForegroundColor DarkGray
Write-Host ''
