# =====================================================================
#  MURAL AZIME - Iniciar
#  1) atualiza a lista de fotos
#  2) sobe um servidor local (para o tablet abrir pela rede Wi-Fi)
#  3) abre o mural neste PC e mostra o endereco do tablet
#  Enquanto estiver aberto, re-varre a pasta FOTOS a cada minuto: foto
#  nova aparece no mural sozinha.
#  Feche esta janela (ou Ctrl+C) para desligar o servidor.
# =====================================================================
[CmdletBinding()]
param(
  [int]$Porta = 5500,
  [switch]$NaoAbrirNavegador
)

$Aqui = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }

function Titulo($t) { Write-Host ''; Write-Host "  $t" -ForegroundColor Cyan }

# ---------- 1) lista de fotos ----------
& (Join-Path $Aqui 'atualizar-fotos.ps1')
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { Write-Host '  Falha ao gerar a lista de fotos.' -ForegroundColor Red; return }

# ---------- 2) servidor ----------
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command py -ErrorAction SilentlyContinue }
if (-not $python) {
  Titulo 'Python nao encontrado'
  Write-Host '  Sem Python o tablet nao pode abrir pela rede.'
  Write-Host '  Mas o mural funciona neste PC: abra o arquivo mural.html com duplo-clique.' -ForegroundColor Yellow
  Write-Host ''
  return
}

$emUso = Get-NetTCPConnection -LocalPort $Porta -State Listen -ErrorAction SilentlyContinue
if ($emUso) {
  Titulo "A porta $Porta ja esta em uso"
  Write-Host '  Provavelmente o mural ja esta rodando em outra janela.'
  Write-Host "  Feche a outra janela, ou rode assim para usar outra porta:" -ForegroundColor Yellow
  Write-Host "     .\iniciar-mural.ps1 -Porta 5600" -ForegroundColor Yellow
  Write-Host ''
  return
}

$srv = Start-Process -FilePath $python.Source `
  -ArgumentList @('-m', 'http.server', "$Porta", '--bind', '0.0.0.0', '--directory', $Aqui) `
  -WindowStyle Hidden -PassThru

Start-Sleep -Milliseconds 900
if ($srv.HasExited) {
  Titulo 'O servidor nao subiu'
  Write-Host '  Abra o mural.html com duplo-clique (funciona neste PC, sem o tablet).' -ForegroundColor Yellow
  return
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
       Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notlike '*VPN*' } |
       Select-Object -First 1).IPAddress

$urlPC     = "http://localhost:$Porta/mural.html"
$urlTablet = if ($ip) { "http://${ip}:$Porta/mural.html" } else { $null }

Titulo 'MURAL NO AR'
Write-Host '  ------------------------------------------------'
Write-Host "  Neste PC   : $urlPC"
if ($urlTablet) {
  Write-Host "  No TABLET  : $urlTablet" -ForegroundColor Green
  Write-Host '               (tablet e PC precisam estar na MESMA rede Wi-Fi)' -ForegroundColor DarkGray
} else {
  Write-Host '  No TABLET  : sem rede Wi-Fi detectada neste PC' -ForegroundColor Yellow
}
Write-Host '  ------------------------------------------------'
Write-Host '  Se o tablet nao abrir, o Firewall do Windows esta bloqueando:' -ForegroundColor DarkGray
Write-Host '  na primeira vez ele pergunta - marque "Redes privadas" e permita.' -ForegroundColor DarkGray
Write-Host ''
Write-Host '  Deixe ESTA JANELA ABERTA. Ctrl+C para desligar.' -ForegroundColor Yellow
Write-Host ''

if (-not $NaoAbrirNavegador) { Start-Process $urlPC }

# ---------- 3) re-varre a pasta enquanto roda ----------
try {
  while (-not $srv.HasExited) {
    Start-Sleep -Seconds 60
    try {
      & (Join-Path $Aqui 'atualizar-fotos.ps1') -Silencioso
      Write-Host ("  [{0}] lista de fotos revista" -f (Get-Date -Format 'HH:mm')) -ForegroundColor DarkGray
    } catch {
      Write-Host ("  [{0}] falha ao revisar a lista: {1}" -f (Get-Date -Format 'HH:mm'), $_.Exception.Message) -ForegroundColor DarkYellow
    }
  }
}
finally {
  if ($srv -and -not $srv.HasExited) {
    Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue
    Write-Host ''
    Write-Host '  Servidor desligado.' -ForegroundColor DarkGray
  }
}
