# =====================================================================
#  MURAL AZIME - Preparar as fotos
#
#  1) Varre a pasta FOTOS e separa por marca (ALINARE / GRACE / NOVITAH...)
#  2) IGNORA subpastas de material nao tratado e de video
#  3) Gera copias LEVES para o tablet em "_otimizadas" (os originais NAO
#     sao alterados) - foto de 10 MB vira ~400 KB
#  4) Grava a lista em fotos.json e fotos.js
#
#  Rode de novo sempre que adicionar fotos: ele so processa as novas.
# =====================================================================
[CmdletBinding()]
param(
  [string]$Raiz,
  [string]$Saida,
  [int]$MaxPx = 1920,        # maior lado da copia leve (tablet/TV Full HD)
  [int]$Qualidade = 82,      # qualidade JPEG da copia leve
  [switch]$SemOtimizar,      # usa os originais (pesado - so no PC)
  [switch]$Silencioso
)

$ErrorActionPreference = 'Stop'

$Aqui = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $Raiz)  { $Raiz  = Join-Path $Aqui 'FOTOS' }
if (-not $Saida) { $Saida = $Aqui }

$NomeCache = '_otimizadas'

# Extensoes que o navegador exibe
$ExtOk = @('.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif')

# Pastas ignoradas: se QUALQUER pasta do caminho casar com um destes
# trechos, a foto fica fora do mural (comparacao sem acento/maiuscula).
$Ignorar = @(
  @{ trecho = 'sem trat';   motivo = 'sem tratamento' },
  @{ trecho = 'semtratar';  motivo = 'sem tratamento' },
  @{ trecho = 'nao tratad'; motivo = 'sem tratamento' },
  @{ trecho = 'sem edi';    motivo = 'sem edicao' },
  @{ trecho = 'nao usar';   motivo = 'marcada como nao usar' },
  @{ trecho = 'video';      motivo = 'pasta de video' },
  @{ trecho = 'raw';        motivo = 'arquivo bruto' },
  @{ trecho = 'bruta';      motivo = 'arquivo bruto' },
  @{ trecho = 'descarte';   motivo = 'descarte' },
  @{ trecho = 'lixo';       motivo = 'descarte' }
)

function Remove-Acento([string]$texto) {
  if ([string]::IsNullOrEmpty($texto)) { return '' }
  $d = $texto.Normalize([Text.NormalizationForm]::FormD)
  $sb = New-Object Text.StringBuilder
  foreach ($c in $d.ToCharArray()) {
    if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($c) -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
      [void]$sb.Append($c)
    }
  }
  return $sb.ToString().Normalize([Text.NormalizationForm]::FormC).ToLowerInvariant()
}

# ordena "natural": POCKET 2 antes de POCKET 10
function Chave-Natural([string]$texto) {
  return [regex]::Replace((Remove-Acento $texto), '\d+', { param($m) $m.Value.PadLeft(12, '0') })
}

if (-not (Test-Path -LiteralPath $Raiz)) { throw "Pasta de fotos nao encontrada: $Raiz" }

$raizFull = (Get-Item -LiteralPath $Raiz).FullName
$nomeRaiz = (Get-Item -LiteralPath $Raiz).Name
$cacheDir = Join-Path $Saida $NomeCache

# ---------------------------------------------------------------------
# 1) seleciona as fotos
# ---------------------------------------------------------------------
$selecionadas = New-Object Collections.ArrayList
$ignorados    = @{}
$semSuporte   = @{}

foreach ($f in (Get-ChildItem -LiteralPath $raizFull -Recurse -File -ErrorAction SilentlyContinue)) {
  if ($f.Name.StartsWith('~$') -or $f.Name.StartsWith('.')) { continue }

  $rel   = $f.FullName.Substring($raizFull.Length).TrimStart('\', '/')
  $parts = $rel -split '\\'

  # alguma pasta do caminho esta na lista de ignorados?
  $pulou = $null
  if ($parts.Count -gt 1) {
    foreach ($seg in $parts[0..($parts.Count - 2)]) {
      $segN = Remove-Acento $seg
      foreach ($regra in $Ignorar) {
        if ($segN -like "*$($regra.trecho)*") { $pulou = $regra.motivo; break }
      }
      if ($pulou) { break }
    }
  }
  if ($pulou) {
    if (-not $ignorados.ContainsKey($pulou)) { $ignorados[$pulou] = 0 }
    $ignorados[$pulou]++
    continue
  }

  $ext = $f.Extension.ToLowerInvariant()
  if ($ExtOk -notcontains $ext) {
    if (-not $semSuporte.ContainsKey($ext)) { $semSuporte[$ext] = 0 }
    $semSuporte[$ext]++
    continue
  }

  [void]$selecionadas.Add([pscustomobject]@{
    arquivo = $f
    rel     = ($rel -replace '\\', '/')
    marca   = if ($parts.Count -gt 1) { $parts[0] } else { 'GERAL' }
    chave   = (Chave-Natural $rel)
  })
}

# ---------------------------------------------------------------------
# 1b) nome do arquivo de destino de cada copia leve
#     Duas fotos na MESMA pasta que so diferem na extensao (foto.jpg e
#     foto.jpeg) virariam o mesmo .jpg: uma sobrescreveria a outra e
#     sumiria do mural. Nesse caso o nome carrega a extensao original.
# ---------------------------------------------------------------------
function Rel-Destino([string]$rel, [bool]$comExtensao) {
  $ext = [IO.Path]::GetExtension($rel)
  $sem = $rel.Substring(0, $rel.Length - $ext.Length)
  if ($comExtensao) { return ($sem + '_' + $ext.TrimStart('.').ToLowerInvariant() + '.jpg') }
  return ($sem + '.jpg')
}

$quantos = @{}
foreach ($it in $selecionadas) {
  $k = (Rel-Destino $it.rel $false).ToLowerInvariant()
  if (-not $quantos.ContainsKey($k)) { $quantos[$k] = 0 }
  $quantos[$k]++
}
$colisoes = 0
foreach ($it in $selecionadas) {
  $k = (Rel-Destino $it.rel $false).ToLowerInvariant()
  $conflito = ($quantos[$k] -gt 1)
  if ($conflito) { $colisoes++ }
  $it | Add-Member -NotePropertyName destRel -NotePropertyValue (Rel-Destino $it.rel $conflito) -Force
}

# ---------------------------------------------------------------------
# 2) copias leves
# ---------------------------------------------------------------------
$mapaLeve  = @{}   # rel original -> caminho web da copia leve
$feitas = 0; $reaproveitadas = 0; $falhas = 0; $pesoOrig = 0; $pesoLeve = 0

if (-not $SemOtimizar) {
  Add-Type -AssemblyName System.Drawing
  $encJpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $encPar  = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $encPar.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]$Qualidade)

  $i = 0
  foreach ($it in $selecionadas) {
    $i++
    $origem = $it.arquivo
    $pesoOrig += $origem.Length

    # destino: mesmo caminho relativo dentro de _otimizadas, sempre .jpg
    $relJpg  = $it.destRel
    $destino = Join-Path $cacheDir ($relJpg -replace '/', '\')
    $pastaD  = Split-Path -Parent $destino
    if (-not (Test-Path -LiteralPath $pastaD)) { New-Item -ItemType Directory -Path $pastaD -Force | Out-Null }

    # ja existe e esta atualizada? reaproveita
    if (Test-Path -LiteralPath $destino) {
      $d = Get-Item -LiteralPath $destino
      if ($d.LastWriteTimeUtc -ge $origem.LastWriteTimeUtc -and $d.Length -gt 0) {
        $mapaLeve[$it.rel] = ($NomeCache + '/' + $relJpg)
        $pesoLeve += $d.Length
        $reaproveitadas++
        continue
      }
    }

    if (-not $Silencioso -and ($i % 10 -eq 0 -or $i -eq 1)) {
      Write-Host ("  otimizando {0}/{1}..." -f $i, $selecionadas.Count) -ForegroundColor DarkGray
    }

    $img = $null; $bmp = $null; $g = $null
    try {
      $img = [System.Drawing.Image]::FromFile($origem.FullName)

      # respeita a orientacao da camera (EXIF), senao a foto sai deitada
      if ($img.PropertyIdList -contains 0x0112) {
        switch ($img.GetPropertyItem(0x0112).Value[0]) {
          2 { $img.RotateFlip([System.Drawing.RotateFlipType]::RotateNoneFlipX) }
          3 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate180FlipNone) }
          4 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate180FlipX) }
          5 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipX) }
          6 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone) }
          7 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate270FlipX) }
          8 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate270FlipNone) }
        }
      }

      $escala = [Math]::Min(1.0, $MaxPx / [double][Math]::Max($img.Width, $img.Height))
      $lw = [Math]::Max(1, [int][Math]::Round($img.Width  * $escala))
      $lh = [Math]::Max(1, [int][Math]::Round($img.Height * $escala))

      $bmp = New-Object System.Drawing.Bitmap($lw, $lh, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.Clear([System.Drawing.Color]::White)
      $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $g.DrawImage($img, 0, 0, $lw, $lh)
      $g.Dispose(); $g = $null
      $img.Dispose(); $img = $null

      $bmp.Save($destino, $encJpeg, $encPar)
      $bmp.Dispose(); $bmp = $null

      $mapaLeve[$it.rel] = ($NomeCache + '/' + $relJpg)
      $pesoLeve += (Get-Item -LiteralPath $destino).Length
      $feitas++
    }
    catch {
      # nao conseguiu otimizar: o mural usa o original mesmo
      $falhas++
      if (-not $Silencioso) {
        Write-Host ("  [aviso] nao consegui otimizar: {0}" -f $it.rel) -ForegroundColor DarkYellow
      }
    }
    finally {
      if ($g)   { $g.Dispose() }
      if ($bmp) { $bmp.Dispose() }
      if ($img) { $img.Dispose() }
    }

    if ($i % 25 -eq 0) { [GC]::Collect() }
  }
  [GC]::Collect()
}

# ---------------------------------------------------------------------
# 2b) apaga copias leves que nao correspondem mais a nenhuma foto
#     (foto removida do OneDrive, renomeada, ou movida para SEM TRATAR).
#     Mexe SO dentro de _otimizadas, que e refeita quando precisar.
# ---------------------------------------------------------------------
$orfaos = 0
if (-not $SemOtimizar -and (Test-Path -LiteralPath $cacheDir)) {
  $esperados = @{}
  foreach ($it in $selecionadas) {
    $esperados[(Join-Path $cacheDir ($it.destRel -replace '/', '\')).ToLowerInvariant()] = $true
  }
  foreach ($f in (Get-ChildItem -LiteralPath $cacheDir -Recurse -File -ErrorAction SilentlyContinue)) {
    if (-not $esperados.ContainsKey($f.FullName.ToLowerInvariant())) {
      Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue
      $orfaos++
    }
  }
  # pastas que ficaram vazias
  foreach ($d in (Get-ChildItem -LiteralPath $cacheDir -Recurse -Directory -ErrorAction SilentlyContinue | Sort-Object { $_.FullName.Length } -Descending)) {
    if (-not (Get-ChildItem -LiteralPath $d.FullName -Force -ErrorAction SilentlyContinue)) {
      Remove-Item -LiteralPath $d.FullName -Force -ErrorAction SilentlyContinue
    }
  }
}

# ---------------------------------------------------------------------
# 3) monta a lista
# ---------------------------------------------------------------------
$porMarca = @{}
foreach ($it in ($selecionadas | Sort-Object chave)) {
  if (-not $porMarca.ContainsKey($it.marca)) { $porMarca[$it.marca] = New-Object Collections.ArrayList }
  $web = if ($mapaLeve.ContainsKey($it.rel)) { $mapaLeve[$it.rel] } else { $nomeRaiz + '/' + $it.rel }
  [void]$porMarca[$it.marca].Add($web)
}

# toda subpasta de FOTOS conta como marca, mesmo que ainda nao tenha nenhuma
# foto tratada: assim o botao dela aparece no mural como "aguardando fotos"
foreach ($d in (Get-ChildItem -LiteralPath $raizFull -Directory -ErrorAction SilentlyContinue)) {
  if (-not $porMarca.ContainsKey($d.Name)) { $porMarca[$d.Name] = New-Object Collections.ArrayList }
}

$marcas = [ordered]@{}
foreach ($m in ($porMarca.Keys | Sort-Object { Chave-Natural $_ })) { $marcas[$m] = @($porMarca[$m]) }

$total = 0
foreach ($k in $marcas.Keys) { $total += $marcas[$k].Count }

$dados = [ordered]@{
  gerado = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  total  = $total
  marcas = $marcas
}

$json = $dados | ConvertTo-Json -Depth 6
$json | Out-File -FilePath (Join-Path $Saida 'fotos.json') -Encoding utf8
"window.MURAL_FOTOS = $json;" | Out-File -FilePath (Join-Path $Saida 'fotos.js') -Encoding utf8

# ---------------------------------------------------------------------
# 4) resumo
# ---------------------------------------------------------------------
if (-not $Silencioso) {
  Write-Host ''
  Write-Host '  MURAL AZIME - fotos preparadas' -ForegroundColor Cyan
  Write-Host '  --------------------------------------------'
  foreach ($k in $marcas.Keys) {
    Write-Host ("  {0,-16} {1,4} fotos" -f $k, $marcas[$k].Count) -ForegroundColor Green
  }
  Write-Host ("  {0,-16} {1,4} fotos no mural" -f 'TOTAL', $total) -ForegroundColor Green

  if ($ignorados.Count) {
    Write-Host ''
    Write-Host '  Fora do mural (de proposito):' -ForegroundColor DarkYellow
    foreach ($k in ($ignorados.Keys | Sort-Object)) {
      Write-Host ("    {0,4} x {1}" -f $ignorados[$k], $k) -ForegroundColor DarkYellow
    }
  }
  if ($semSuporte.Count) {
    Write-Host ''
    Write-Host '  Arquivos que o navegador nao exibe (ignorados):' -ForegroundColor DarkGray
    foreach ($k in ($semSuporte.Keys | Sort-Object)) {
      Write-Host ("    {0,4} x {1}" -f $semSuporte[$k], $k) -ForegroundColor DarkGray
    }
  }
  if (-not $SemOtimizar) {
    Write-Host ''
    Write-Host '  Copias leves para o tablet:' -ForegroundColor Cyan
    Write-Host ("    {0} novas, {1} reaproveitadas, {2} falhas" -f $feitas, $reaproveitadas, $falhas)
    if ($colisoes -gt 0) {
      Write-Host ("    {0} com nome repetido em extensoes diferentes (ex.: foto.jpg + foto.jpeg)" -f $colisoes) -ForegroundColor DarkYellow
      Write-Host '      -> essas ganharam a extensao no nome para nenhuma sumir' -ForegroundColor DarkGray
    }
    if ($orfaos -gt 0) {
      Write-Host ("    {0} copias antigas apagadas (foto removida ou renomeada na origem)" -f $orfaos) -ForegroundColor DarkGray
    }
    if ($pesoOrig -gt 0) {
      Write-Host ("    {0} MB de originais  ->  {1} MB no mural" -f [math]::Round($pesoOrig/1MB), [math]::Round($pesoLeve/1MB)) -ForegroundColor Green
    }
    Write-Host '    (os originais em FOTOS nao foram alterados)' -ForegroundColor DarkGray
  }
  Write-Host ''
}
