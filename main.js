// flow-map — Electron 메인 프로세스
// 내부 HTTP 서버(127.0.0.1 전용)가 뷰어와 데이터 폴더를 서빙한다 (Go 서버와 동일 API + Electron 확장).
const { app, BrowserWindow, dialog, shell } = require('electron');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const VERSION = require('./package.json').version;
const REPO = 'youjeonghan/flow-map';
const WEB_DIR = path.join(__dirname, 'web');
const SKILL_SRC = path.join(__dirname, 'skills', 'flow-sync', 'SKILL.md');

let win = null;
let dataDir = null;
let baseURL = '';

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
    const headers = { 'User-Agent': 'flow-map', Accept: accept || 'application/vnd.github+json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    https.get(url, { headers }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        // 리다이렉트(S3)에는 Authorization을 보내지 않는다
        https.get(res.headers.location, { headers: { 'User-Agent': 'flow-map' } }, r2 => resolve(r2))
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
    if (res.statusCode === 404) hint += ' — private 저장소는 GitHub 토큰이 필요해요 (gh CLI 로그인 또는 설정)';
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
            dataDir: dataDir || '',
            projectKey: dataDir || '(none)',
            skillInstalled: dataDir ? skillInstalled(dataDir) : false,
            needProject: !dataDir,
            canPick: true,
            canUpdate: true
          });
        }
        if (u.startsWith('/api/pick-folder')) {
          if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
          const r = await dialog.showOpenDialog(win, {
            title: 'flow.json이 있는 데이터 폴더 선택',
            properties: ['openDirectory']
          });
          if (r.canceled || !r.filePaths.length) return sendJSON(res, { ok: false });
          dataDir = r.filePaths[0];
          const cfg = loadConfig();
          cfg.lastProject = dataDir;
          cfg.recent = [dataDir, ...(cfg.recent || []).filter(p => p !== dataDir)].slice(0, 10);
          saveConfig(cfg);
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
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

/* ---------- 창 ---------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1560, height: 980,
    title: 'flow-map',
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

app.whenReady().then(async () => {
  const cfg = loadConfig();
  if (cfg.lastProject && fs.existsSync(path.join(cfg.lastProject, 'flow.json'))) {
    dataDir = cfg.lastProject;
  }
  const port = await startServer();
  baseURL = `http://127.0.0.1:${port}/`;
  console.log('flow-map v' + VERSION + ' → ' + baseURL + (dataDir ? ' (데이터: ' + dataDir + ')' : ' (프로젝트 미선택)'));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
