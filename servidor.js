/* =====================================================================
   MURAL AZIME - servidor local com painel de envio

   Serve o mural (index.html, grace.html, novitah.html, _otimizadas) e
   ainda oferece o painel em /painel, onde da para ADICIONAR e EXCLUIR
   fotos e videos sem mexer em pasta nem no git.

   Ao subir ou excluir, ele roda o atualizar-fotos.ps1 sozinho: a copia
   leve e a lista (fotos.json) sao refeitas e o mural passa a mostrar o
   novo material - o "espelho automatico".

   Suba com:  Abrir painel.cmd
   ===================================================================== */
'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const prep    = require('./preparar');

const AQUI  = __dirname;          // codigo e paginas
const DADOS = prep.DADOS;         // onde ficam os arquivos (no Railway: o volume)
const FOTOS = prep.FOTOS;
const PORTA = Number(process.env.PORT || process.env.PORTA || 5500);

/* A senha do painel NAO fica escrita neste arquivo: o repositorio e publico,
   e quem lesse o codigo poderia apagar as fotos. A ordem de busca e:
     1. variavel de ambiente PAINEL_SENHA  (e assim que se configura no Railway)
     2. arquivo senha.txt na pasta         (fica fora do repositorio, .gitignore)
   Se nenhum existir, o senha.txt e criado com a senha padrao combinada.     */
// fora da pasta servida sempre que possivel (no Railway, dentro do volume)
const ARQ_SENHA = path.join(DADOS, 'senha.txt');
const SENHA_PADRAO = 'AZIME' + '2026';

function lerSenha() {
  if (process.env.PAINEL_SENHA) return process.env.PAINEL_SENHA.trim();
  try {
    const s = fs.readFileSync(ARQ_SENHA, 'utf8').trim();
    if (s) return s;
  } catch (e) { /* nao existe: cria abaixo */ }
  try {
    fs.writeFileSync(ARQ_SENHA, SENHA_PADRAO + '\n', 'utf8');
    console.log(`  [senha] criei o senha.txt com a senha padrao. Troque quando quiser.`);
  } catch (e) { /* somente leitura: segue sem senha */ }
  return SENHA_PADRAO;
}

const SENHA = lerSenha();

// As mesmas camadas do mural. Cada destino e uma pasta dentro de FOTOS\.
const CAMADAS = [
  {
    id: 'principal', titulo: 'Alinare e Grace', link: '/',
    destinos: [
      { rotulo: 'LANÇAMENTO Alinare', pasta: 'ALINARE/LANÇAMENTO' },
      { rotulo: 'LANÇAMENTO Grace',   pasta: 'GRACE/LANÇAMENTO'   },
      { rotulo: 'ALINARE',            pasta: 'ALINARE'            },
      { rotulo: 'GRACE',              pasta: 'GRACE'              }
    ]
  },
  {
    id: 'grace', titulo: 'Grace', link: '/grace.html',
    destinos: [
      { rotulo: 'LANÇAMENTO Grace', pasta: 'GRACE/LANÇAMENTO' },
      { rotulo: 'GRACE',            pasta: 'GRACE'            }
    ]
  },
  {
    id: 'novitah', titulo: 'Novitah', link: '/novitah.html',
    destinos: [
      { rotulo: 'NOVITAH',            pasta: 'NOVITAH'            },
      { rotulo: 'LANÇAMENTO Novitah', pasta: 'NOVITAH/LANÇAMENTO' }
    ]
  }
];

// toda pasta que o painel aceita como destino (protege contra caminho fora)
const PASTAS_OK = new Set();
CAMADAS.forEach(c => c.destinos.forEach(d => PASTAS_OK.add(d.pasta)));

const EXT_OK = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif',
                        '.mp4', '.mov', '.avi', '.mkv', '.m4v']);

/* ---------------------------------------------------------------- upload */

const armazem = multer.diskStorage({
  destination(req, file, cb) {
    const pasta = String(req.body.pasta || '');
    if (!PASTAS_OK.has(pasta)) return cb(new Error('Destino inválido: ' + pasta));
    const dir = path.join(FOTOS, ...pasta.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    // nome original, com sufixo se ja existir (nunca sobrescreve)
    const base = path.basename(file.originalname);
    const ext  = path.extname(base);
    const nome = base.slice(0, base.length - ext.length) || 'arquivo';
    const dir  = path.join(FOTOS, ...String(req.body.pasta).split('/'));
    let tenta = base, n = 2;
    while (fs.existsSync(path.join(dir, tenta))) { tenta = `${nome} (${n++})${ext}`; }
    cb(null, tenta);
  }
});

const receber = multer({
  storage: armazem,
  limits: { fileSize: 600 * 1024 * 1024 },   // 600 MB por arquivo
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!EXT_OK.has(ext)) return cb(new Error('Tipo não aceito: ' + ext));
    cb(null, true);
  }
});

/* -------------------------------------------------- preparar (o espelho) */

let preparando = false;
let fila = false;
let ultimoLog = 'ainda nao rodou';
let agendado = null;

// junta varias mudancas em uma unica preparacao (ex.: excluir 10 fotos seguidas)
function prepararEmBreve(ms) {
  if (agendado) clearTimeout(agendado);
  agendado = setTimeout(() => { agendado = null; preparar(); }, ms || 1200);
}

async function preparar() {
  if (preparando) { fila = true; return { jaRodando: true }; }
  preparando = true;
  const linhas = [];
  try {
    const r = await prep.preparar({ aviso: t => { if (t) linhas.push(t); } });
    ultimoLog = linhas.slice(-25).join('\n');
    console.log(`  [preparar] ${r.total} itens em ${r.segundos}s ` +
                `(${r.feitas} novas, ${r.orfaos} orfas apagadas)`);
    return r;
  } catch (e) {
    ultimoLog = 'falha ao preparar: ' + e.message;
    console.log('  [preparar] ' + ultimoLog);
    return { erro: e.message };
  } finally {
    preparando = false;
    if (fila) { fila = false; preparar(); }
  }
}

/* ------------------------------------------------------------------- api */

const app = express();
app.use(express.json());

/* --------------------------------------------------------------- proteção
   O painel apaga arquivo de verdade, entao nao pode ficar aberto na internet.
   - com PAINEL_SENHA definida: pede usuario/senha sempre
   - sem senha: libera so no proprio PC e na rede local (uso caseiro), e
     recusa qualquer acesso de fora, para nao expor por descuido            */

function ehLocal(ip) {
  const s = String(ip || '').replace(/^::ffff:/, '');
  return s === '127.0.0.1' || s === '::1' || s === 'localhost' ||
         /^10\./.test(s) || /^192\.168\./.test(s) ||
         /^172\.(1[6-9]|2\d|3[01])\./.test(s);
}

function protegido(req, res, next) {
  if (SENHA) {
    const cab = req.headers.authorization || '';
    const [tipo, dado] = cab.split(' ');
    if (tipo === 'Basic' && dado) {
      const [, pass] = Buffer.from(dado, 'base64').toString('utf8').split(':');
      if (pass === SENHA) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Painel do Mural", charset="UTF-8"');
    return res.status(401).send('Painel do Mural: informe a senha.');
  }
  if (ehLocal(req.ip)) return next();
  return res.status(403).send(
    'Painel bloqueado: sem senha configurada, ele só abre no PC e na rede local.\n' +
    'Para liberar na internet, defina a variável PAINEL_SENHA no servidor.');
}

app.use('/api', protegido);
app.get('/api/camadas', (req, res) => res.json({ camadas: CAMADAS }));

const EXT_VIDEO = new Set(['.mp4', '.mov', '.avi', '.mkv', '.m4v']);

function semAcento(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// varre a pasta INTEIRA, com subpastas: as fotos antigas estao em
// "FESTA 3107", "GREGO_SEM DATA" etc., nao soltas na raiz da marca
function varrer(base, rel) {
  const out = [];
  const dir = rel ? path.join(base, ...rel.split('/')) : base;
  let entradas = [];
  try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entradas) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...varrer(base, r));
    else if (e.isFile() && EXT_OK.has(path.extname(e.name).toLowerCase())) out.push(r);
  }
  return out;
}

// endereco da copia leve, para a miniatura nao baixar o original de 11 MB
function copiaLeve(relCompleto, video) {
  const extNova = video ? '.mp4' : '.jpg';
  const extOrig = path.extname(relCompleto).slice(1).toLowerCase();
  const semExt = relCompleto.replace(/\.[^./]+$/, '');
  for (const t of [semExt + extNova, semExt + '_' + extOrig + extNova]) {
    if (fs.existsSync(path.join(AQUI, '_otimizadas', ...t.split('/')))) return '_otimizadas/' + t;
  }
  return null;
}

// o que ja existe em cada destino (le a pasta de originais, com subpastas)
app.get('/api/itens', (req, res) => {
  const pasta = String(req.query.pasta || '');
  if (!PASTAS_OK.has(pasta)) return res.status(400).json({ erro: 'destino inválido' });

  const dir = path.join(FOTOS, ...pasta.split('/'));
  if (!fs.existsSync(dir)) return res.json({ itens: [] });

  // na raiz da marca, o que esta em LANCAMENTO nao entra: e outro destino
  const ehRaizDeMarca = !pasta.includes('/');

  const itens = varrer(dir, '')
    .filter(rel => !(ehRaizDeMarca && semAcento(rel.split('/')[0]) === 'lancamento'))
    .map(rel => {
      const abs = path.join(dir, ...rel.split('/'));
      let st; try { st = fs.statSync(abs); } catch (e) { return null; }
      const video = EXT_VIDEO.has(path.extname(rel).toLowerCase());
      const partes = rel.split('/');
      const nome = partes.pop();
      const leve = copiaLeve(pasta + '/' + rel, video);
      return {
        rel,                              // caminho dentro do destino
        nome,
        sub: partes.join(' / '),          // subpasta, para voce saber de onde e
        mb: +(st.size / 1048576).toFixed(2),
        video,
        thumb: leve,                      // null = nao esta no mural
        noMural: !!leve,
        quando: st.mtime.toISOString()
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.sub + '/' + a.nome).localeCompare(b.sub + '/' + b.nome, 'pt', { numeric: true }));

  res.json({ itens, total: itens.length, noMural: itens.filter(i => i.noMural).length });
});

app.post('/api/upload', (req, res) => {
  receber.array('arquivos', 200)(req, res, async err => {
    if (err) return res.status(400).json({ erro: err.message });
    const nomes = (req.files || []).map(f => f.filename);
    if (!nomes.length) return res.status(400).json({ erro: 'nenhum arquivo recebido' });

    console.log(`  [upload] ${nomes.length} arquivo(s) em ${req.body.pasta}`);
    const r = await preparar();
    res.json({ ok: true, enviados: nomes, preparar: r });
  });
});

app.post('/api/excluir', (req, res) => {
  const pasta = String((req.body && req.body.pasta) || '');
  // aceita subpasta: "FESTA 3107/FEST2102.jpg"
  const rel = String((req.body && (req.body.rel || req.body.nome)) || '').replace(/\\/g, '/');
  if (!PASTAS_OK.has(pasta)) return res.status(400).json({ erro: 'destino inválido' });
  if (!rel || rel.split('/').some(p => p === '..' || p === '')) {
    return res.status(400).json({ erro: 'caminho inválido' });
  }

  const raizDestino = path.resolve(FOTOS, ...pasta.split('/'));
  const alvo = path.resolve(raizDestino, ...rel.split('/'));
  if (alvo !== raizDestino && !alvo.startsWith(raizDestino + path.sep)) {
    return res.status(400).json({ erro: 'caminho fora do destino' });
  }
  if (!fs.existsSync(alvo) || !fs.statSync(alvo).isFile()) {
    return res.status(404).json({ erro: 'arquivo não encontrado' });
  }

  fs.unlinkSync(alvo);
  console.log(`  [excluir] ${pasta}/${rel}`);
  // a copia leve sai na limpeza de orfaos. Agendado, nao imediato: apagando
  // varios seguidos, roda UMA vez ao final em vez de uma vez por arquivo.
  prepararEmBreve();
  res.json({ ok: true, agendado: true });
});

app.get('/api/estado', (req, res) => {
  let total = 0, grupos = {};
  try {
    const j = JSON.parse(fs.readFileSync(path.join(AQUI, 'fotos.json'), 'utf8'));
    total = j.total || 0;
    grupos = Object.fromEntries(Object.entries(j.marcas || {}).map(([k, v]) => [k, v.length]));
  } catch (e) { /* ainda nao existe */ }
  res.json({ preparando: preparando || !!agendado, total, grupos, log: ultimoLog });
});

/* ---------------------------------------------------------------- paginas */

/* NUNCA servir estes arquivos: o express.static entrega tudo que esta na
   pasta, e sem esta trava o /senha.txt ficava publico - com a senha dentro. */
const NEGADOS = [
  /^\/senha\.txt$/i,
  /^\/servidor\.js$/i,
  /^\/preparar\.js$/i,
  /^\/package(-lock)?\.json$/i,
  /^\/node_modules\//i,
  /^\/_ferramentas\//i,
  /^\/\.(git|nvmrc|env)/i
];
app.use((req, res, next) => {
  if (NEGADOS.some(r => r.test(req.path))) return res.status(404).end();
  next();
});

// /painel e /painel.html: os dois pedem senha. Sem a segunda linha, o
// static entregava o painel.html direto, contornando a protecao.
app.get(/^\/painel(\.html)?$/i, protegido, (req, res) =>
  res.sendFile(path.join(AQUI, 'painel.html')));

// arquivos e lista saem de DADOS (no Railway, o volume); o resto e o codigo
app.use('/_otimizadas', express.static(path.join(DADOS, '_otimizadas'), { maxAge: '7d' }));
app.use('/FOTOS',       express.static(FOTOS));            // miniatura de item fora do mural
app.get('/fotos.json',  (req, res) => res.sendFile(path.join(DADOS, 'fotos.json')));
app.get('/fotos.js',    (req, res) => res.sendFile(path.join(DADOS, 'fotos.js')));
app.use(express.static(AQUI, { index: 'index.html', extensions: ['html'] }));

/* -------------------------------------------------------------------- sobe */

function ipDaRede() {
  const nets = require('os').networkInterfaces();
  for (const nome of Object.keys(nets)) {
    if (/vpn|virtual|loopback/i.test(nome)) continue;
    for (const n of nets[nome] || []) {
      if (n.family === 'IPv4' && !n.internal) return n.address;
    }
  }
  return null;
}

// se a lista ainda nao existe (ex.: volume novo no Railway), prepara ao subir
if (!fs.existsSync(path.join(DADOS, 'fotos.json'))) {
  console.log('  [inicio] sem fotos.json ainda: preparando...');
  preparar();
}

app.listen(PORTA, '0.0.0.0', () => {
  const ip = ipDaRede();
  console.log('');
  console.log(`  dados em: ${DADOS}`);
  console.log(`  painel  : ${SENHA ? 'com senha (PAINEL_SENHA)' : 'sem senha - liberado so no PC e na rede local'}`);
  console.log('');
  console.log('  MURAL AZIME - no ar');
  console.log('  ------------------------------------------------');
  console.log(`  Painel (adicionar/excluir) : http://localhost:${PORTA}/painel`);
  console.log(`  Alinare e Grace            : http://localhost:${PORTA}/`);
  console.log(`  Grace                      : http://localhost:${PORTA}/grace.html`);
  console.log(`  Novitah                    : http://localhost:${PORTA}/novitah.html`);
  if (ip) {
    console.log('  ------------------------------------------------');
    console.log(`  No tablet (mesma Wi-Fi)    : http://${ip}:${PORTA}/`);
  }
  console.log('  ------------------------------------------------');
  console.log('  Deixe esta janela aberta. Ctrl+C para desligar.');
  console.log('');
});
