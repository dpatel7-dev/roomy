'use strict';
// Finding space: how full the disk is, the easy wins, and the biggest folders.
//
// roomy only ever looks inside your home folder, and only suggests things that
// come back by themselves or that you already threw away. Sizes come from
// `du`, the system's own measuring tool, which is quick even on big folders.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const HOME = () => process.env.ROOMY_TARGET_HOME || os.homedir();
const MAC = () => (process.env.ROOMY_OS || process.platform) === 'darwin';
const DAY = 86400000;

/** How full the disk with your home folder is: { total, used, free } in bytes. */
function disk() {
  const r = spawnSync('df', ['-kP', HOME()], { encoding: 'utf8' });
  const line = String(r.stdout || '').trim().split('\n').pop() || '';
  const p = line.split(/\s+/);
  const total = Number(p[1]) * 1024;
  const free = Number(p[3]) * 1024;
  if (!total) return null;
  return { total, free, used: total - free };
}

/** Sizes of many paths at once, in bytes: Map(path → size). Paths du can't read count as 0. */
function sizes(paths, { signal } = {}) {
  return new Promise((resolve) => {
    const out = new Map(paths.map((p) => [p, 0]));
    if (!paths.length) return resolve(out);
    const child = spawn('du', ['-sk', ...paths], { stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '';
    child.stdout.on('data', (d) => { buf += d; });
    const stop = () => { try { child.kill(); } catch { /* gone */ } };
    if (signal) signal.addEventListener('abort', stop, { once: true });
    child.on('close', () => {
      for (const l of buf.split('\n')) {
        const m = /^(\d+)\s+(.*)$/.exec(l);
        if (m && out.has(m[2])) out.set(m[2], Number(m[1]) * 1024);
      }
      resolve(out);
    });
    child.on('error', () => resolve(out));
  });
}

const kids = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } };
const lst = (p) => { try { return fs.lstatSync(p); } catch { return null; } };

/** Inside your home folder (and not your home folder itself)? Links never count. */
function safe(p) {
  const rel = path.relative(HOME(), p);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const st = lst(p);
  return !!st && !st.isSymbolicLink();
}

const INSTALLER = /\.(dmg|pkg|mpkg|iso|xip|zip|exe|msi|deb|rpm|appimage)$/i;
const PKG_CACHES = () => (MAC()
  ? ['Library/Caches/Homebrew', 'Library/Caches/pip', 'Library/Caches/Yarn', 'Library/Caches/pnpm', '.npm/_cacache', 'Library/Caches/go-build']
  : ['.cache/pip', '.cache/yarn', '.cache/pnpm', '.npm/_cacache', '.cache/go-build']).map((p) => path.join(HOME(), p));
const trashDir = () => (MAC() ? path.join(HOME(), '.Trash') : path.join(HOME(), '.local', 'share', 'Trash', 'files'));

/** Folders called node_modules in projects nobody has touched for 3 months. */
function oldNodeModules({ maxDirs = 15000, age = 90 * DAY } = {}) {
  const found = [];
  let seen = 0;
  const skip = new Set(['Library', '.Trash', 'Applications', '.cache', '.npm', '.local', 'Pictures', 'Music', 'Movies']);
  const walk = (dir, depth) => {
    if (seen++ > maxDirs || depth > 6) return;
    for (const d of kids(dir)) {
      if (!d.isDirectory() || d.isSymbolicLink()) continue;
      if (depth === 0 && skip.has(d.name)) continue;
      const full = path.join(dir, d.name);
      if (d.name === 'node_modules') {
        // how long since the project was last touched (its package.json or the folder itself)
        const pj = lst(path.join(dir, 'package.json'));
        const when = Math.max(pj ? pj.mtimeMs : 0, (lst(dir) || { mtimeMs: 0 }).mtimeMs);
        if (pj && Date.now() - when > age) found.push(full);
        continue; // never look inside node_modules
      }
      if (d.name.startsWith('.')) continue;
      walk(full, depth + 1);
    }
  };
  walk(HOME(), 0);
  return found;
}

/**
 * The easy wins. Each: { id, name, why, how: 'trash'|'empty', paths, on (ticked
 * at first), note }. Sizes are measured afterwards (measure()), since that's
 * the slow part.
 */
function wins() {
  const h = HOME();
  const out = [];
  const t = trashDir();
  out.push({ id: 'trash', name: 'Empty the Trash', why: "Things you already threw away. Emptying the Trash deletes them for good, so roomy asks first.", how: 'empty', paths: fs.existsSync(t) ? [t] : [], on: false });
  const dl = path.join(h, 'Downloads');
  const old = [];
  for (const d of kids(dl)) {
    const full = path.join(dl, d.name);
    const st = lst(full);
    if (st && !st.isSymbolicLink() && INSTALLER.test(d.name) && Date.now() - Math.max(st.mtimeMs, st.atimeMs) > 30 * DAY) old.push(full);
  }
  out.push({ id: 'installers', name: 'Old installers in Downloads', why: "Installers (.dmg, .pkg, .zip…) you downloaded more than a month ago. Once the app is installed, you don't need them.", how: 'trash', paths: old, on: true });
  const cacheRoot = path.join(h, MAC() ? 'Library/Caches' : '.cache');
  const pkg = new Set(PKG_CACHES());
  const caches = kids(cacheRoot).filter((d) => !d.isSymbolicLink() && !/^com\.apple\./.test(d.name) && !d.name.startsWith('.')).map((d) => path.join(cacheRoot, d.name)).filter((p) => !pkg.has(p));
  out.push({ id: 'caches', name: 'App caches', why: 'Apps keep these to open things faster, and make them again when they need them. Quit your apps first for the best result.', how: 'trash', paths: caches, on: true });
  const dev = MAC() ? ['Library/Developer/Xcode/DerivedData', 'Library/Developer/CoreSimulator/Caches', 'Library/Developer/Xcode/iOS DeviceSupport'] : [];
  const xcode = dev.map((p) => path.join(h, p)).flatMap((p) => kids(p).map((d) => path.join(p, d.name)));
  if (MAC()) out.push({ id: 'xcode', name: 'Xcode leftovers', why: 'Build files and phone support files Xcode makes again by itself when it needs them.', how: 'trash', paths: xcode, on: true });
  out.push({ id: 'packages', name: 'Saved downloads from Homebrew, npm and pip', why: 'Copies of things these tools downloaded once. They download them again if they ever need to.', how: 'trash', paths: PKG_CACHES().filter((p) => fs.existsSync(p)), on: true });
  out.push({ id: 'node', name: 'node_modules in old projects', why: "Code libraries inside projects you haven't touched in 3 months. Typing npm install in the project brings them back.", how: 'trash', paths: null, on: false }); // found while measuring
  out.push(out.shift()); // the Trash last: it's the only one that can't be undone
  return out.map((w) => ({ ...w, paths: w.paths && w.paths.filter((p) => w.how === 'empty' || safe(p)), size: null, items: null }));
}

/** Measure the wins (filling in .size and .items, biggest first), calling onOne(win) as each finishes. */
async function measure(list, { onOne = () => {}, signal } = {}) {
  for (const w of list) {
    if (signal && signal.aborted) return;
    if (w.id === 'node') w.paths = oldNodeModules().filter(safe);
    if (w.how === 'empty') {
      const t = w.paths[0];
      const inside = t ? kids(t).map((d) => path.join(t, d.name)) : [];
      if (t && !inside.length && fs.existsSync(t) && MAC()) { // macOS keeps the Trash private from Terminal
        const s = await sizes([t], { signal });
        w.size = s.get(t) || null;
        w.private = !s.get(t);
      } else {
        const s = await sizes(inside, { signal });
        w.size = [...s.values()].reduce((a, b) => a + b, 0);
        w.count = inside.length;
      }
      w.items = [];
    } else {
      const s = await sizes(w.paths, { signal });
      w.items = w.paths.map((p) => ({ path: p, size: s.get(p) || 0 })).filter((x) => x.size > 0).sort((a, b) => b.size - a.size);
      w.size = w.items.reduce((a, b) => a + b.size, 0);
    }
    onOne(w);
  }
}

/** What's in a folder, biggest first: [{ path, name, size, dir }]. */
async function inside(dir, { signal } = {}) {
  const list = kids(dir).filter((d) => !d.isSymbolicLink()).map((d) => ({ path: path.join(dir, d.name), name: d.name, dir: d.isDirectory() }));
  const s = await sizes(list.map((x) => x.path), { signal });
  return list.map((x) => ({ ...x, size: s.get(x.path) || 0 })).sort((a, b) => b.size - a.size);
}

module.exports = { disk, sizes, wins, measure, inside, safe, oldNodeModules, trashDir, HOME, MAC, INSTALLER };
