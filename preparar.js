/* =====================================================================
   MURAL AZIME - preparar fotos e videos

   Substitui o atualizar-fotos.ps1: as MESMAS regras, mas em Node, para
   rodar tanto no Windows (aqui) quanto no Linux (Railway). Uma
   implementacao so, para as regras nao divergirem entre os dois.

   - varre a pasta FOTOS
   - ignora subpasta de material nao tratado (SEM TRATAR, SEM EDICAO...)
   - gera copia leve: foto 1920px/JPEG e video de 15s sem som, 1280px
   - apaga copia orfa (arquivo que voce removeu na origem)
   - grava fotos.json e fotos.js

   Uso:  node preparar.js            (silencioso: --silencioso)
   ===================================================================== */
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawn } = require('child_process');
const sharp = require('sharp');

const RAIZ  = __dirname;
const DADOS = process.env.DADOS_DIR || RAIZ;     // no Railway: o volume
const FOTOS = path.join(DADOS, 'FOTOS');
const CACHE = path.join(DADOS, '_otimizadas');
const NOME_CACHE = '_otimizadas';
const LANCAMENTO = 'LANCAMENTO';                 // chave sem acento, de proposito

const MAX_PX          = Number(process.env.MAX_PX || 1920);
const QUALIDADE       = Number(process.env.QUALIDADE || 82);
const VIDEO_SEGUNDOS  = Number(process.env.VIDEO_SEGUNDOS || 15);
const VIDEO_LADO      = Number(process.env.VIDEO_LADO || 1280);
const SEM_VIDEO       = process.env.SEM_VIDEO === '1';

const EXT_FOTO  = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);
const EXT_VIDEO = new Set(['.mp4', '.mov', '.avi', '.mkv', '.m4v', '.webm']);

// Se QUALQUER pasta do caminho casar com um destes trechos, o arquivo fica
// fora do mural. 'video' NAO esta aqui: pasta de video entra, mas dela se
// aproveitam apenas os videos.
const IGNORAR = [
  ['sem trat',    'sem tratamento'],
  ['semtratar',   'sem tratamento'],
  ['nao tratad',  'sem tratamento'],
  ['sem edi',     'sem edicao'],
  ['nao edit',    'sem edicao'],
  ['sem editar',  'sem edicao'],
  ['nao finaliz', 'sem edicao'],
  ['nao usar',    'marcada como nao usar'],
  ['raw',         'arquivo bruto'],
  ['bruta',       'arquivo bruto'],
  ['descarte',    'descarte'],
  ['lixo',        'descarte']
];

/* --------------------------------------------------------------- ajudantes */

function semAcento(s) {
  return String(s).normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();
}

// ordena "natural": POCKET 2 antes de POCKET 10
function chaveNatural(s) {
  return semAcento(s).replace(/\d+/g, m => m.padStart(12, '0'));
}

function ffmpegExe() {
  try { return require('ffmpeg-static'); } catch (e) { /* segue */ }
  // sobra o ffmpeg portatil da pasta, se existir
  const dir = path.join(RAIZ, '_ferramentas');
  const achar = d => {
    let itens = [];
    try { itens = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return null; }
    for (const it of itens) {
      const p = path.join(d, it.name);
      if (it.isDirectory()) { const r = achar(p); if (r) return r; }
      else if (/^ffmpeg(\.exe)?$/i.test(it.name)) return p;
    }
    return null;
  };
  return achar(dir);
}

function varrer(base, rel = '') {
  const out = [];
  const dir = rel ? path.join(base, ...rel.split('/')) : base;
  let itens = [];
  try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const it of itens) {
    const r = rel ? rel + '/' + it.name : it.name;
    if (it.isDirectory()) out.push(...varrer(base, r));
    else if (it.isFile()) out.push(r);
  }
  return out;
}

// nome da copia leve; com conflito, carrega a extensao original no nome
// (foto.jpg + foto.jpeg iriam para o MESMO destino e uma sumiria)
function relDestino(rel, comExtensao, extNova) {
  const ext = path.extname(rel);
  const sem = rel.slice(0, rel.length - ext.length);
  return comExtensao
    ? sem + '_' + ext.slice(1).toLowerCase() + extNova
    : sem + extNova;
}

function selo(arquivo) {
  try {
    return Math.floor(fs.statSync(arquivo).mtimeMs).toString(16).slice(-8);
  } catch (e) { return '0'; }
}

/* --------------------------------------------------------------- selecao */

function selecionar() {
  const escolhidos = [];
  const ignorados = {}, semSuporte = {};

  if (!fs.existsSync(FOTOS)) return { escolhidos, ignorados, semSuporte };

  for (const rel of varrer(FOTOS)) {
    const nome = path.basename(rel);
    if (nome.startsWith('~$') || nome.startsWith('.')) continue;

    const partes = rel.split('/');
    const pastas = partes.slice(0, -1);

    let motivo = null;
    for (const seg of pastas) {
      const s = semAcento(seg);
      const regra = IGNORAR.find(([trecho]) => s.includes(trecho));
      if (regra) { motivo = regra[1]; break; }
    }
    if (motivo) { ignorados[motivo] = (ignorados[motivo] || 0) + 1; continue; }

    const ext = path.extname(nome).toLowerCase();
    const tipo = EXT_FOTO.has(ext) ? 'foto' : (EXT_VIDEO.has(ext) ? 'video' : null);
    if (!tipo) { semSuporte[ext] = (semSuporte[ext] || 0) + 1; continue; }

    if (tipo === 'video' && SEM_VIDEO) {
      ignorados['video desligado'] = (ignorados['video desligado'] || 0) + 1;
      continue;
    }
    // em pasta de VIDEO, imagem solta e miniatura: nao entra
    if (tipo === 'foto' && pastas.some(p => semAcento(p).includes('video'))) {
      ignorados['imagem em pasta de video'] = (ignorados['imagem em pasta de video'] || 0) + 1;
      continue;
    }

    const marca = pastas.length ? pastas[0] : 'GERAL';
    const ehLancamento = pastas.slice(1).some(p => semAcento(p).includes('lancamento'));

    escolhidos.push({
      rel,
      tipo,
      grupo: ehLancamento ? marca + '/' + LANCAMENTO : marca,
      ordem: chaveNatural(rel)
    });
  }

  // destino de cada um, tratando conflito de extensao
  const contagem = {};
  for (const it of escolhidos) {
    const k = relDestino(it.rel, false, it.tipo === 'video' ? '.mp4' : '.jpg').toLowerCase();
    contagem[k] = (contagem[k] || 0) + 1;
  }
  let colisoes = 0;
  for (const it of escolhidos) {
    const extNova = it.tipo === 'video' ? '.mp4' : '.jpg';
    const k = relDestino(it.rel, false, extNova).toLowerCase();
    const conflito = contagem[k] > 1;
    if (conflito) colisoes++;
    it.destRel = relDestino(it.rel, conflito, extNova);
  }

  return { escolhidos, ignorados, semSuporte, colisoes };
}

/* ------------------------------------------------------------- conversao */

async function converterFoto(origem, destino) {
  await sharp(origem, { failOn: 'none' })
    .rotate()                                   // respeita a orientacao da camera
    .resize({ width: MAX_PX, height: MAX_PX, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })         // PNG transparente vira fundo branco
    .jpeg({ quality: QUALIDADE, progressive: true })
    .toFile(destino);
}

function converterVideo(exe, origem, destino) {
  return new Promise((ok, falha) => {
    const filtro = `scale='if(gt(iw,ih),${VIDEO_LADO},-2)':'if(gt(iw,ih),-2,${VIDEO_LADO})'`;
    const p = spawn(exe, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', origem, '-t', String(VIDEO_SEGUNDOS), '-an',
      '-vf', filtro,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      destino
    ]);
    let erro = '';
    p.stderr.on('data', d => { erro += d.toString(); });
    p.on('close', c => (c === 0 ? ok() : falha(new Error(erro.trim() || ('ffmpeg saiu ' + c)))));
    p.on('error', falha);
  });
}

/* ---------------------------------------------------------------- limpeza */

function apagarOrfaos(esperados) {
  if (!fs.existsSync(CACHE)) return 0;
  let n = 0;
  for (const rel of varrer(CACHE)) {
    if (!esperados.has(rel.toLowerCase())) {
      try { fs.unlinkSync(path.join(CACHE, ...rel.split('/'))); n++; } catch (e) {}
    }
  }
  // pastas que ficaram vazias
  const limpar = dir => {
    let itens = [];
    try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const it of itens) if (it.isDirectory()) limpar(path.join(dir, it.name));
    try { if (!fs.readdirSync(dir).length && dir !== CACHE) fs.rmdirSync(dir); } catch (e) {}
  };
  limpar(CACHE);
  return n;
}

/* ------------------------------------------------------------------ main */

// quantos itens a lista atual tem (para nao apagar por engano)
function totalNaLista() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DADOS, 'fotos.json'), 'utf8')).total || 0;
  } catch (e) { return 0; }
}

async function preparar({ silencioso = false, aviso = () => {} } = {}) {
  const t0 = Date.now();
  const { escolhidos, ignorados, semSuporte, colisoes } = selecionar();

  // TRAVA: sem originais, nao mexe em nada. Serve para o caso do servidor
  // rodar onde a pasta FOTOS nao existe (ela nao vai para o repositorio):
  // sem isso, a lista seria reescrita vazia e o mural ficaria sem nada.
  if (!escolhidos.length) {
    const jaTem = totalNaLista();
    if (jaTem > 0) {
      const msg = `  [trava] nenhum arquivo em ${FOTOS} - mantive a lista atual (${jaTem} itens) intacta`;
      if (!silencioso) aviso(msg);
      return { total: jaTem, naoMexeu: true, motivo: 'sem originais', segundos: 0,
               marcas: {}, qtFoto: 0, qtVideo: 0, feitas: 0, reaproveitadas: 0,
               falhas: 0, orfaos: 0, colisoes: 0, semFfmpeg: 0, semCopia: 0,
               ignorados: {}, semSuporte: {}, mbOrig: 0, mbLeve: 0 };
    }
  }
  const exe = SEM_VIDEO ? null : ffmpegExe();

  let feitas = 0, reaproveitadas = 0, falhas = 0, semFfmpeg = 0;
  let pesoOrig = 0, pesoLeve = 0;
  const mapa = new Map();          // rel original -> caminho web da copia leve

  for (let i = 0; i < escolhidos.length; i++) {
    const it = escolhidos[i];
    const origem = path.join(FOTOS, ...it.rel.split('/'));
    let st; try { st = fs.statSync(origem); } catch (e) { continue; }
    pesoOrig += st.size;

    const destino = path.join(CACHE, ...it.destRel.split('/'));
    fs.mkdirSync(path.dirname(destino), { recursive: true });

    // ja existe e esta atualizada? reaproveita
    try {
      const d = fs.statSync(destino);
      if (d.mtimeMs >= st.mtimeMs && d.size > 0) {
        mapa.set(it.rel, NOME_CACHE + '/' + it.destRel);
        pesoLeve += d.size;
        reaproveitadas++;
        continue;
      }
    } catch (e) { /* nao existe: converte */ }

    if (!silencioso && (i % 10 === 0 || it.tipo === 'video')) {
      const q = it.tipo === 'video' ? 'video: ' + path.basename(it.rel) : `${i + 1}/${escolhidos.length}`;
      aviso(`  preparando ${q}`);
    }

    try {
      if (it.tipo === 'video') {
        if (!exe) { semFfmpeg++; continue; }
        await converterVideo(exe, origem, destino);
      } else {
        await converterFoto(origem, destino);
      }
      mapa.set(it.rel, NOME_CACHE + '/' + it.destRel);
      pesoLeve += fs.statSync(destino).size;
      feitas++;
    } catch (e) {
      falhas++;
      if (!silencioso) aviso(`  [aviso] nao converteu: ${it.rel} (${e.message.split('\n')[0]})`);
    }
  }

  // orfaos: tudo em _otimizadas que nao corresponde a nenhum escolhido
  const esperados = new Set(escolhidos.map(it => it.destRel.toLowerCase()));
  const orfaos = apagarOrfaos(esperados);

  /* ---- lista ---- */
  const porGrupo = {};
  let semCopia = 0;
  for (const it of escolhidos.slice().sort((a, b) => a.ordem.localeCompare(b.ordem))) {
    const web = mapa.get(it.rel);
    if (!web) { semCopia++; continue; }       // sem copia leve nao entra: daria 404
    (porGrupo[it.grupo] = porGrupo[it.grupo] || [])
      .push(web + '?v=' + selo(path.join(DADOS, ...web.split('/'))));
  }

  // toda marca e todo LANCAMENTO aparecem, mesmo vazios ("aguardando fotos")
  try {
    for (const d of fs.readdirSync(FOTOS, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      porGrupo[d.name] = porGrupo[d.name] || [];
      porGrupo[d.name + '/' + LANCAMENTO] = porGrupo[d.name + '/' + LANCAMENTO] || [];
    }
  } catch (e) {}

  const marcas = {};
  for (const k of Object.keys(porGrupo).sort((a, b) => chaveNatural(a).localeCompare(chaveNatural(b)))) {
    marcas[k] = porGrupo[k];
  }
  const total = Object.values(marcas).reduce((s, v) => s + v.length, 0);

  const dados = { gerado: new Date().toISOString().slice(0, 19).replace('T', ' '), total, marcas };
  const json = JSON.stringify(dados, null, 2);
  fs.writeFileSync(path.join(DADOS, 'fotos.json'), json, 'utf8');       // sem BOM
  fs.writeFileSync(path.join(DADOS, 'fotos.js'), `window.MURAL_FOTOS = ${json};`, 'utf8');

  const qtVideo = escolhidos.filter(it => it.tipo === 'video' && mapa.has(it.rel)).length;
  const resumo = {
    total, qtVideo, qtFoto: total - qtVideo, marcas: Object.fromEntries(
      Object.entries(marcas).map(([k, v]) => [k, v.length])),
    feitas, reaproveitadas, falhas, orfaos, colisoes, semFfmpeg, semCopia,
    ignorados, semSuporte,
    mbOrig: Math.round(pesoOrig / 1048576), mbLeve: Math.round(pesoLeve / 1048576),
    segundos: +((Date.now() - t0) / 1000).toFixed(1)
  };

  if (!silencioso) imprimir(resumo, aviso);
  return resumo;
}

function imprimir(r, aviso) {
  aviso('');
  aviso('  MURAL AZIME - preparado');
  aviso('  --------------------------------------------');
  for (const [k, v] of Object.entries(r.marcas)) aviso(`  ${k.padEnd(22)} ${String(v).padStart(4)} itens`);
  aviso(`  ${'TOTAL'.padEnd(22)} ${String(r.total).padStart(4)}  (${r.qtFoto} fotos + ${r.qtVideo} videos)`);
  if (Object.keys(r.ignorados).length) {
    aviso('');
    aviso('  Fora do mural (de proposito):');
    for (const [k, v] of Object.entries(r.ignorados).sort()) aviso(`    ${String(v).padStart(4)} x ${k}`);
  }
  if (Object.keys(r.semSuporte).length) {
    aviso('');
    aviso('  Arquivos que o navegador nao exibe:');
    for (const [k, v] of Object.entries(r.semSuporte).sort()) aviso(`    ${String(v).padStart(4)} x ${k}`);
  }
  aviso('');
  aviso('  Copias leves:');
  aviso(`    ${r.feitas} novas, ${r.reaproveitadas} reaproveitadas, ${r.falhas} falhas, ${r.orfaos} orfas apagadas`);
  if (r.colisoes) aviso(`    ${r.colisoes} com nome repetido em extensoes diferentes (ganharam a extensao no nome)`);
  if (r.semFfmpeg) aviso(`    ${r.semFfmpeg} videos de fora: falta o ffmpeg`);
  if (r.semCopia) aviso(`    ${r.semCopia} arquivos de fora por nao gerar copia leve`);
  aviso(`    ${r.mbOrig} MB de originais  ->  ${r.mbLeve} MB no mural`);
  aviso(`    em ${r.segundos}s`);
  aviso('');
}

module.exports = { preparar, DADOS, FOTOS, CACHE, LANCAMENTO };

if (require.main === module) {
  const silencioso = process.argv.includes('--silencioso');
  preparar({ silencioso, aviso: t => console.log(t) })
    .then(r => process.exit(r.falhas > 0 && r.total === 0 ? 1 : 0))
    .catch(e => { console.error('FALHOU:', e); process.exit(1); });
}
