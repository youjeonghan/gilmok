// 길목(gilmok) — Electron 메인 프로세스
// 내부 HTTP 서버(127.0.0.1 전용)가 뷰어와 데이터 폴더를 서빙한다 (Go 서버와 동일 API + Electron 확장).
const { app, BrowserWindow, dialog, shell } = require('electron');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const { WebSocketServer } = require('ws');

// pty는 프리빌트(@lydell/node-pty) — 로드 실패 시 터미널 기능만 비활성
let ptyMod = null;
try { ptyMod = require('@lydell/node-pty'); } catch (e) { console.warn('node-pty 로드 실패:', e.message); }

const VERSION = require('./package.json').version;
const APP_NAME = '길목';
const REPO = 'youjeonghan/gilmok';
const WEB_DIR = path.join(__dirname, 'web');
const SKILL_SRC = path.join(__dirname, 'skills', 'flow-sync', 'SKILL.md');

let win = null;
let dataDir = null;
let baseURL = '';

/* ---------- 터미널 세션 (claude CLI on pty) ---------- */
// 패널을 닫아도 세션은 유지 — WS 재접속 시 버퍼 리플레이로 복원
let term = null; // { p, buffer: string[], bufLen, ws }
function termSpawn(cols, rows) {
  const cwd = dataDir || app.getPath('home');
  let file, args;
  if (process.platform === 'win32') {
    file = process.env.ComSpec || 'cmd.exe';
    args = ['/s', '/c', 'claude'];
  } else {
    file = process.env.SHELL || '/bin/zsh';
    args = ['-l', '-c', 'claude'];
  }
  const p = ptyMod.spawn(file, args, {
    name: 'xterm-256color',
    cols: cols || 100, rows: rows || 30,
    cwd, env: { ...process.env }
  });
  term = { p, buffer: [], bufLen: 0, ws: (term && term.ws) || null };
  p.onData(d => {
    term.buffer.push(d);
    term.bufLen += d.length;
    while (term.bufLen > 200000 && term.buffer.length > 1) {
      term.bufLen -= term.buffer[0].length;
      term.buffer.shift();
    }
    if (term.ws && term.ws.readyState === 1) term.ws.send(JSON.stringify({ t: 'o', d }));
  });
  p.onExit(({ exitCode }) => {
    if (term) {
      term.p = null;
      if (term.ws && term.ws.readyState === 1) term.ws.send(JSON.stringify({ t: 'exit', code: exitCode }));
    }
  });
}
function attachTermWS(ws) {
  if (!ptyMod) { ws.send(JSON.stringify({ t: 'err', msg: 'Terminal unavailable in this build (pty failed to load)' })); ws.close(); return; }
  if (term && term.ws && term.ws !== ws) { try { term.ws.close(); } catch (e) {} }
  if (!term || !term.p) {
    try { termSpawn(); } catch (e) {
      ws.send(JSON.stringify({ t: 'err', msg: 'Failed to launch claude: ' + e.message }));
      return;
    }
  }
  term.ws = ws;
  ws.send(JSON.stringify({ t: 'hello', cwd: dataDir || '', replay: term.buffer.join('') }));
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!term) return;
    if (m.t === 'i' && term.p) term.p.write(m.d);
    else if (m.t === 'r' && term.p && m.cols > 0 && m.rows > 0) {
      try { term.p.resize(m.cols, m.rows); } catch (e) {}
    } else if (m.t === 'restart') {
      if (term.p) { try { term.p.kill(); } catch (e) {} }
      term.buffer = []; term.bufLen = 0; term.p = null;
      try {
        termSpawn(m.cols, m.rows);
        term.ws = ws;
        ws.send(JSON.stringify({ t: 'restarted' }));
      } catch (e) { ws.send(JSON.stringify({ t: 'err', msg: 'Failed to launch claude: ' + e.message })); }
    }
  });
  ws.on('close', () => { if (term && term.ws === ws) term.ws = null; });
}

/* ---------- 씬 PNG 썸네일 (카드·미니맵·삽입 프리뷰용 실사 축소판) ----------
 * 오프스크린 창으로 씬 HTML을 렌더 → capturePage → 640px PNG로 캐시.
 * 캐시 키 = 경로 해시 + mtime → 씬 파일이 바뀌면 자동 재생성. */
const THUMB_W = 640;
const thumbDir = () => path.join(app.getPath('userData'), 'thumbs');
let thumbWin = null;
let thumbChain = Promise.resolve();
const thumbKey = rel => crypto.createHash('sha1').update(rel).digest('hex').slice(0, 16);
function generateThumb(absFile, out) {
  const work = (async () => {
    if (!thumbWin || thumbWin.isDestroyed()) {
      thumbWin = new BrowserWindow({
        show: false, width: 1280, height: 800, frame: false,
        webPreferences: { offscreen: true, sandbox: true, backgroundThrottling: false }
      });
    }
    await thumbWin.loadURL(pathToFileURL(absFile).href);
    await new Promise(r => setTimeout(r, 450)); // 폰트·초기 렌더 안정화
    const img = await thumbWin.webContents.capturePage();
    const png = img.resize({ width: THUMB_W }).toPNG();
    fs.mkdirSync(thumbDir(), { recursive: true });
    fs.writeFileSync(out, png);
    return out;
  })();
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('thumb timeout')), 10000));
  return Promise.race([work, timeout]);
}
function getThumb(rel) {
  const base = path.normalize(dataDir);
  const abs = path.normalize(path.join(base, rel));
  if (!abs.startsWith(base)) return Promise.reject(new Error('bad path'));
  const st = fs.statSync(abs);
  const out = path.join(thumbDir(), thumbKey(rel) + '-' + Math.round(st.mtimeMs) + '.png');
  if (fs.existsSync(out)) return Promise.resolve(out);
  const job = thumbChain.then(() => {
    if (fs.existsSync(out)) return out;
    return generateThumb(abs, out).then(p => {
      // 같은 씬의 옛 mtime 캐시 정리
      const prefix = thumbKey(rel) + '-';
      try {
        for (const f of fs.readdirSync(thumbDir())) {
          if (f.startsWith(prefix) && path.join(thumbDir(), f) !== out) {
            try { fs.unlinkSync(path.join(thumbDir(), f)); } catch (e) {}
          }
        }
      } catch (e) {}
      return p;
    });
  });
  thumbChain = job.catch(() => {});
  return job;
}

/* ---------- 데이터 폴더 외부 변경 감시 (SSE) ----------
 * flow.json → 'change' (문서 리로드) · 그 외(씬 HTML 등) → 'scenes' (썸네일만 갱신) */
const sseClients = new Set();
let watcher = null, watchTimer = null, scenesTimer = null;
function broadcast(type) {
  for (const res of sseClients) {
    try { res.write('data: ' + type + '\n\n'); } catch (e) {}
  }
}
function watchDataDir() {
  if (watcher) { try { watcher.close(); } catch (e) {} watcher = null; }
  if (!dataDir) return;
  const onWatch = (ev, fn) => {
    const name = String(fn || '').replace(/\\/g, '/');
    if (name === 'flow.json') {
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => broadcast('change'), 150);
    } else {
      clearTimeout(scenesTimer);
      scenesTimer = setTimeout(() => broadcast('scenes'), 300);
    }
  };
  // recursive는 win/mac 지원 — 실패 시 최상위만 감시(구 동작)
  try { watcher = fs.watch(dataDir, { recursive: true }, onWatch); }
  catch (e) { try { watcher = fs.watch(dataDir, onWatch); } catch (e2) {} }
}

/* ---------- 설정 (최근 프로젝트) ---------- */
const configPath = () => path.join(app.getPath('userData'), 'config.json');
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8').replace(/^﻿/, ''));
  } catch (e) { return {}; }
}
function saveConfig(c) {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(c, null, 2));
  } catch (e) {}
}

/* ---------- 유틸 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};
function sendJSON(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function serveFile(res, root, urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const full = path.normalize(path.join(root, p));
  if (!full.startsWith(path.normalize(root))) { res.writeHead(403); res.end(); return; }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(buf);
  });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => { size += c.length; if (size > 50 << 20) req.destroy(); else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* ---------- 스킬 설치 ---------- */
function projectRoot(dir) {
  let d = dir;
  for (;;) {
    try { if (fs.statSync(path.join(d, '.git')).isDirectory()) return d; } catch (e) {}
    const parent = path.dirname(d);
    if (parent === d) return app.getPath('home');
    d = parent;
  }
}
const skillDest = dir => path.join(projectRoot(dir), '.claude', 'skills', 'flow-sync', 'SKILL.md');
const skillInstalled = dir => { try { fs.statSync(skillDest(dir)); return true; } catch (e) { return false; } };

/* ---------- GitHub 업데이트 확인/다운로드 (수동 방식) ---------- */
function ghToken() {
  return new Promise(resolve => {
    const cfg = loadConfig();
    if (cfg.githubToken) return resolve(cfg.githubToken);
    if (process.env.GITHUB_TOKEN) return resolve(process.env.GITHUB_TOKEN);
    execFile('gh', ['auth', 'token'], { timeout: 5000 }, (err, out) => {
      resolve(err ? '' : out.trim());
    });
  });
}
function ghRequest(url, token, accept) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'gilmok', Accept: accept || 'application/vnd.github+json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    https.get(url, { headers }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        // 리다이렉트(S3)에는 Authorization을 보내지 않는다
        https.get(res.headers.location, { headers: { 'User-Agent': 'gilmok' } }, r2 => resolve(r2))
          .on('error', reject);
        return;
      }
      resolve(res);
    }).on('error', reject);
  });
}
async function latestRelease() {
  const token = await ghToken();
  const res = await ghRequest(`https://api.github.com/repos/${REPO}/releases/latest`, token);
  if (res.statusCode !== 200) {
    let hint = 'HTTP ' + res.statusCode;
    if (res.statusCode === 404) hint += ' — private releases need a GitHub token (gh CLI login or config)';
    res.resume();
    throw new Error(hint);
  }
  const body = await new Promise((ok, no) => {
    const c = [];
    res.on('data', d => c.push(d)); res.on('end', () => ok(Buffer.concat(c).toString())); res.on('error', no);
  });
  return { release: JSON.parse(body), token };
}
function pickAsset(assets) {
  const names = assets.map(a => a.name);
  const find = re => assets[names.findIndex(n => re.test(n))];
  if (process.platform === 'win32') return find(/setup.*\.exe$/i) || find(/windows.*\.exe$/i);
  if (process.platform === 'darwin') {
    if (process.arch === 'arm64') return find(/arm64.*\.dmg$/i) || find(/\.dmg$/i) || find(/darwin-arm64/);
    return find(/x64.*\.dmg$/i) || find(/\.dmg$/i) || find(/darwin-amd64/);
  }
  return null;
}
function downloadAsset(asset, token) {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await ghRequest(asset.url, token, 'application/octet-stream');
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('다운로드 HTTP ' + res.statusCode)); }
      const dest = path.join(app.getPath('temp'), asset.name);
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve(dest)));
      out.on('error', reject);
    } catch (e) { reject(e); }
  });
}

/* ---------- HTTP 서버 ---------- */
function startServer() {
  return new Promise(resolve => {
    const server = http.createServer(async (req, res) => {
      const u = req.url || '/';
      try {
        if (u.startsWith('/api/health')) {
          return sendJSON(res, {
            version: VERSION,
            appName: APP_NAME,
            dataDir: dataDir || '',
            projectKey: dataDir || '(none)',
            skillInstalled: dataDir ? skillInstalled(dataDir) : false,
            needProject: !dataDir,
            recent: loadConfig().recent || [],
            canPick: true,
            canUpdate: true,
            canTerm: !!ptyMod,
            canThumb: true
          });
        }
        if (u.startsWith('/api/thumb')) {
          if (!dataDir) { res.writeHead(404); return res.end(); }
          const rel = new URL(u, 'http://x').searchParams.get('f') || '';
          try {
            const p = await getThumb(rel);
            res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
            return res.end(fs.readFileSync(p));
          } catch (e) {
            res.writeHead(404); return res.end();
          }
        }
        if (u.startsWith('/api/flow-events')) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-store',
            Connection: 'keep-alive'
          });
          res.write(': hi\n\n');
          sseClients.add(res);
          req.on('close', () => sseClients.delete(res));
          return;
        }
        if (u.startsWith('/api/pick-folder')) {
          if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
          const r = await dialog.showOpenDialog(win, {
            title: 'Select a data folder containing flow.json',
            properties: ['openDirectory']
          });
          if (r.canceled || !r.filePaths.length) return sendJSON(res, { ok: false });
          dataDir = r.filePaths[0];
          const cfg = loadConfig();
          cfg.lastProject = dataDir;
          cfg.recent = [dataDir, ...(cfg.recent || []).filter(p => p !== dataDir)].slice(0, 10);
          saveConfig(cfg);
          watchDataDir();
          return sendJSON(res, { ok: true, dataDir });
        }
        if (u.startsWith('/api/use-folder')) { // 최근 목록에서 바로 전환 (다이얼로그 없이)
          if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
          const body = await readBody(req);
          let dir = '';
          try { dir = JSON.parse(body.toString()).dir || ''; } catch (e) { /* ignore */ }
          if (!dir || !fs.existsSync(path.join(dir, 'flow.json'))) return sendJSON(res, { ok: false, error: 'no flow.json' });
          dataDir = dir;
          const cfg = loadConfig();
          cfg.lastProject = dataDir;
          cfg.recent = [dataDir, ...(cfg.recent || []).filter(p => p !== dataDir)].slice(0, 10);
          saveConfig(cfg);
          watchDataDir();
          return sendJSON(res, { ok: true, dataDir });
        }
        if (u.startsWith('/api/new-project')) { // 위치 선택 → <위치>/<이름>/에 flow.json 스캐폴드
          if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
          const body = await readBody(req);
          let name = '';
          try { name = (JSON.parse(body.toString()).name || '').trim(); } catch (e) { /* ignore */ }
          if (!name) return sendJSON(res, { ok: false, error: '이름이 비어 있어요' });
          const r = await dialog.showOpenDialog(win, {
            title: '새 프로젝트를 만들 위치 선택 — 그 아래에 「' + name + '」 폴더가 생성됩니다',
            properties: ['openDirectory', 'createDirectory']
          });
          if (r.canceled || !r.filePaths.length) return sendJSON(res, { ok: false });
          const safe = name.replace(/[\\/:*?"<>|]+/g, '-').replace(/^\.+/, '').trim() || 'project';
          const dir = path.join(r.filePaths[0], safe);
          if (fs.existsSync(path.join(dir, 'flow.json')))
            return sendJSON(res, { ok: false, error: '이미 flow.json이 있는 폴더예요: ' + dir });
          fs.mkdirSync(path.join(dir, 'scenes'), { recursive: true });
          const tpl = {
            version: 3,
            service: { name, icon: '', designUrl: '' },
            tabs: [{ id: 'main', title: '메인', start: null }],
            scenes: {},
            flows: []
          };
          fs.writeFileSync(path.join(dir, 'flow.json'), JSON.stringify(tpl, null, 2) + '\n');
          dataDir = dir;
          const cfg = loadConfig();
          cfg.lastProject = dataDir;
          cfg.recent = [dataDir, ...(cfg.recent || []).filter(p => p !== dataDir)].slice(0, 10);
          saveConfig(cfg);
          watchDataDir();
          return sendJSON(res, { ok: true, dataDir });
        }
        if (u.startsWith('/api/flow')) {
          if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
          if (!dataDir) return sendJSON(res, { ok: false, error: 'no project' });
          const body = await readBody(req);
          try { JSON.parse(body.toString()); } catch (e) { return sendJSON(res, { ok: false, error: 'invalid json' }); }
          fs.writeFileSync(path.join(dataDir, 'flow.json'), body);
          return sendJSON(res, { ok: true });
        }
        if (u.startsWith('/api/open-folder')) {
          if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
          if (!dataDir) return sendJSON(res, { ok: false, error: 'no project' });
          shell.openPath(dataDir);
          return sendJSON(res, { ok: true });
        }
        if (u.startsWith('/api/install-skill')) {
          if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
          if (!dataDir) return sendJSON(res, { ok: false, error: 'no project' });
          const dest = skillDest(dataDir);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(SKILL_SRC, dest);
          return sendJSON(res, { ok: true, path: dest });
        }
        if (u.startsWith('/api/update-check')) {
          if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
          try {
            const { release } = await latestRelease();
            const latest = (release.tag_name || '').replace(/^v/, '');
            const newer = (a, b) => { // a > b ?
              const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
              for (let i = 0; i < 3; i++) {
                if ((pa[i] || 0) > (pb[i] || 0)) return true;
                if ((pa[i] || 0) < (pb[i] || 0)) return false;
              }
              return false;
            };
            return sendJSON(res, { ok: true, current: VERSION, latest, hasUpdate: latest !== '' && newer(latest, VERSION) });
          } catch (e) { return sendJSON(res, { ok: false, error: e.message }); }
        }
        if (u.startsWith('/api/update-download')) {
          if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
          try {
            const { release, token } = await latestRelease();
            const asset = pickAsset(release.assets || []);
            if (!asset) return sendJSON(res, { ok: false, error: '이 OS용 설치 파일이 릴리스에 없어요' });
            const p = await downloadAsset(asset, token);
            shell.showItemInFolder(p);
            shell.openPath(p);
            return sendJSON(res, { ok: true, path: p });
          } catch (e) { return sendJSON(res, { ok: false, error: e.message }); }
        }
        if (u.startsWith('/data/')) {
          if (!dataDir) { res.writeHead(404); return res.end(); }
          return serveFile(res, dataDir, u.slice('/data'.length));
        }
        return serveFile(res, WEB_DIR, u);
      } catch (e) {
        res.writeHead(500); res.end(String(e));
      }
    });
    const wss = new WebSocketServer({ server, path: '/api/term' });
    wss.on('connection', attachTermWS);
    // 고정 포트 — origin(host:port)이 바뀌면 localStorage(앱 테마·뷰포트·탭 상태)가 통째로 날아간다.
    // 재시작·업데이트에도 유지되도록 고정하고, 점유 중이면 임시 포트로 폴백(그 세션만 상태 미유지).
    server.once('error', err => {
      if (err && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) {
        server.listen(0, '127.0.0.1', () => resolve(server.address().port));
      } else throw err;
    });
    server.listen(47823, '127.0.0.1', () => resolve(server.address().port));
  });
}

/* ---------- 창 ---------- */
const APP_ICON = path.join(__dirname, 'build', 'icon.png');
function createWindow() {
  win = new BrowserWindow({
    width: 1560, height: 980,
    title: APP_NAME,
    ...(fs.existsSync(APP_ICON) ? { icon: APP_ICON } : {}),
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(baseURL)) return { action: 'allow' }; // 씬 실물 보기 등 내부 창
    shell.openExternal(url); // claude.ai 등 외부 링크는 기본 브라우저로
    return { action: 'deny' };
  });
  win.loadURL(baseURL);
}

app.setAppUserModelId('dev.youjeonghan.flowmap'); // 작업표시줄 그룹 아이덴티티 (dev에서도 자체 아이콘·제목 표시)

app.whenReady().then(async () => {
  const cfg = loadConfig();
  if (cfg.lastProject && fs.existsSync(path.join(cfg.lastProject, 'flow.json'))) {
    dataDir = cfg.lastProject;
  }
  watchDataDir();
  const port = await startServer();
  baseURL = `http://127.0.0.1:${port}/`;
  console.log('길목 v' + VERSION + ' → ' + baseURL + (dataDir ? ' (데이터: ' + dataDir + ')' : ' (프로젝트 미선택)'));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
