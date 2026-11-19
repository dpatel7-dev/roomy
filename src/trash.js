'use strict';
// Moving things to the Trash (so you can always change your mind), putting
// them back, and emptying the Trash.
//
// On a Mac things go into ~/.Trash, just as if you'd dragged them there. If
// macOS doesn't let Terminal touch the Trash, roomy asks Finder to do it
// instead (then Finder's "Put Back" works). On Linux it's the standard Trash
// folder your file manager uses.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Look = require('./look');

const home = () => process.env.ROOMY_HOME || path.join(os.homedir(), '.roomy');
const runsDir = () => path.join(home(), 'runs');

function free(dir, name) {
  let n = 1;
  const ext = path.extname(name);
  const base = ext && ext.length < 8 ? name.slice(0, -ext.length) : name;
  let p = path.join(dir, name);
  while (fs.existsSync(p) || fs.existsSync(p + '.trashinfo')) p = path.join(dir, `${base} ${++n}${ext && ext.length < 8 ? ext : ''}`);
  return p;
}

function save(run) {
  fs.mkdirSync(runsDir(), { recursive: true });
  fs.writeFileSync(path.join(runsDir(), `${run.id}.json`), JSON.stringify(run));
}
function runs() {
  let names = [];
  try { names = fs.readdirSync(runsDir()).filter((n) => n.endsWith('.json')); } catch { return []; }
  return names.map((n) => { try { return JSON.parse(fs.readFileSync(path.join(runsDir(), n), 'utf8')); } catch { return null; } }).filter(Boolean).sort((a, b) => b.at - a.at);
}

/** Ask Finder to move these to the Trash (macOS). True if it did. */
function finderTrash(paths) {
  if (!paths.length) return true;
  const list = paths.map((p) => `POSIX file ${JSON.stringify(p)}`).join(', ');
  const r = spawnSync('osascript', ['-e', `tell application "Finder" to delete {${list}}`], { stdio: 'ignore', timeout: 120000 });
  return r.status === 0;
}

/**
 * Move each path to the Trash. Returns the run: { id, at, moved: [{ from, to }],
 * byFinder: [paths], skipped: [{ path, why }], bytes }.
 */
function toTrash(items, { onOne = () => {} } = {}) {
  const run = { id: new Date().toISOString().replace(/[:.]/g, '-'), at: Date.now(), moved: [], byFinder: [], skipped: [], bytes: 0 };
  const tdir = Look.trashDir();
  const info = path.join(path.dirname(tdir), 'info');
  const finder = [];
  let i = 0;
  for (const it of items) {
    i++;
    const p = it.path;
    if (!Look.safe(p)) { run.skipped.push({ path: p, why: "it isn't inside your home folder" }); onOne(i, items.length); continue; }
    try {
      fs.mkdirSync(tdir, { recursive: true });
      const to = free(tdir, path.basename(p));
      if (!Look.MAC()) {
        fs.mkdirSync(info, { recursive: true });
        fs.writeFileSync(path.join(info, path.basename(to) + '.trashinfo'), `[Trash Info]\nPath=${encodeURI(p)}\nDeletionDate=${new Date().toISOString().slice(0, 19)}\n`);
      }
      fs.renameSync(p, to);
      run.moved.push({ from: p, to, size: it.size || 0 });
      run.bytes += it.size || 0;
    } catch (e) {
      if (Look.MAC() && (e.code === 'EPERM' || e.code === 'EACCES')) finder.push(it);
      else run.skipped.push({ path: p, why: e.code === 'EXDEV' ? "it's on another disk" : e.code === 'EBUSY' ? 'an app is using it' : e.code || e.message });
    }
    onOne(i, items.length);
  }
  if (finder.length) {
    if (finderTrash(finder.map((x) => x.path))) { run.byFinder = finder.map((x) => x.path); run.bytes += finder.reduce((a, b) => a + (b.size || 0), 0); }
    else for (const x of finder) run.skipped.push({ path: x.path, why: "macOS didn't allow it" });
  }
  if (run.moved.length || run.byFinder.length) save(run);
  return run;
}

/** Put the last batch back where it was (or the one with this id). */
function putBack(id) {
  const run = id ? runs().find((r) => r.id === id) : runs().find((r) => !r.undone && r.moved.length);
  if (!run) throw new Error('There is nothing to put back.');
  const back = [];
  const stuck = [];
  for (const m of run.moved) {
    try {
      if (fs.existsSync(m.from)) { stuck.push({ ...m, why: 'something else is there now' }); continue; }
      fs.mkdirSync(path.dirname(m.from), { recursive: true });
      fs.renameSync(m.to, m.from);
      try { fs.unlinkSync(path.join(path.dirname(Look.trashDir()), 'info', path.basename(m.to) + '.trashinfo')); } catch { /* a Mac has none */ }
      back.push(m);
    } catch (e) { stuck.push({ ...m, why: e.code === 'ENOENT' ? 'it was emptied from the Trash' : e.code || e.message }); }
  }
  run.undone = Date.now();
  save(run);
  return { back, stuck, finder: run.byFinder || [] };
}

/** Empty the Trash for good. Returns true if it worked. */
function empty() {
  if (Look.MAC()) {
    const r = spawnSync('osascript', ['-e', 'tell application "Finder" to empty trash'], { stdio: 'ignore', timeout: 300000 });
    if (r.status === 0) return true;
  }
  const t = Look.trashDir();
  let ok = true;
  for (const dir of [t, path.join(path.dirname(t), 'info')]) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) { try { fs.rmSync(path.join(dir, n), { recursive: true, force: true }); } catch { ok = false; } }
  }
  return ok;
}

module.exports = { toTrash, putBack, empty, runs, home };
