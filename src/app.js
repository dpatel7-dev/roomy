'use strict';
// roomy's screen.
//
//   roomy   Macintosh HD   112 GB free of 494 GB                          1.0.0
//   ──────────────────────────────────────────────────────────────────────────────
//   [Shelly]   ██████████████████████████████░░░░░░░░  77% full
//              The ticked things below give back 18 GB.
//
//     Easy wins   Biggest folders
//   › ● Old installers in Downloads                2.1 GB
//       Installers you downloaded more than a month ago…
//     ● App caches                                 6.8 GB
//   ──────────────────────────────────────────────────────────────────────────────
//    Press Enter to move 18 GB to the Trash. u puts it all back.
//     enter  clear 18 GB   space tick   ←→ biggest folders   q quit

const os = require('os');
const path = require('path');
const A = require('./ansi');
const Th = require('./theme');
const Shelly = require('./shelly');
const Look = require('./look');
const Trash = require('./trash');
const { Tui, fit, spread, size, bar, open: openThing } = require('./tui');
const pkg = require('../package.json');

const tilde = (p) => (p.startsWith(Look.HOME()) ? '~' + p.slice(Look.HOME().length) : p);
const SPIN = ['◐', '◓', '◑', '◒'];

class App {
  constructor({ input = process.stdin, output = process.stdout } = {}) {
    Th.use(process.env.ROOMY_THEME || 'pool');
    this.tab = 'wins'; // wins | big
    this.mode = 'main'; // main | confirm | done
    this.sel = 0;
    this.mood = { scene: 'idle', at: Date.now() };
    this.flash = null;
    this.disk = Look.disk();
    this.wins = Look.wins();
    this.dir = Look.HOME();
    this.list = null; // what's in this.dir, biggest first
    this.bigSel = 0;
    this.trail = []; // where you came from in Biggest folders, to come back to the same row
    this.ac = new AbortController();
    this.ui = new Tui({ input, output, paper: Th.t().paper, render: (w, h) => this.frame(w, h) });
    this.ui.on('key', (s, k) => this.onKey(s || '', k || {}));
  }

  run() {
    return new Promise((resolve) => {
      this.done = resolve;
      this.ui.start();
      this.ticker = setInterval(() => { if (this.flash && this.flash.until < Date.now()) this.flash = null; this.dirty(); }, 140);
      Look.measure(this.wins, { signal: this.ac.signal, onOne: () => this.dirty() }).then(() => this.dirty());
    });
  }

  quit() { this.ac.abort(); clearInterval(this.ticker); this.ui.stop(); if (this.done) this.done(); }
  dirty() { this.ui.schedule(); }
  say(text, kind = 'dim', ms = 5000) { this.flash = { text, kind, until: Date.now() + ms }; this.dirty(); }
  react(scene) { this.mood = { scene, at: Date.now() }; }

  ticked() { return this.wins.filter((w) => w.on && w.size); }
  tickedBytes() { return this.ticked().reduce((a, b) => a + b.size, 0); }
  measuring() { return this.wins.some((w) => w.size === null); }

  async openDir(dir) {
    this.dir = dir;
    this.list = null;
    this.bigSel = 0;
    this.dirty();
    const here = dir;
    const list = await Look.inside(dir, { signal: this.ac.signal });
    if (this.dir !== here) return; // you moved on while it measured
    this.list = list;
    const back = this.trail.length && this.trail[this.trail.length - 1];
    if (back && back.from && back.from.startsWith(dir)) { const i = list.findIndex((x) => x.path === back.from); if (i >= 0) this.bigSel = i; }
    this.dirty();
  }

  // ── doing it ──
  clean() {
    const list = this.ticked();
    if (!list.length) return this.say(this.measuring() ? 'Still measuring: one moment.' : 'Tick something first: Space ticks the one with the arrow.', 'warn');
    const empty = list.find((w) => w.how === 'empty');
    if (empty) { this.mode = 'confirm'; this.confirm = { kind: 'clean', text: `Emptying the Trash deletes ${size(empty.size)} for good. Go ahead?` }; return this.dirty(); }
    this.doClean();
  }

  doClean() {
    this.react('work');
    const list = this.ticked();
    const items = list.filter((w) => w.how === 'trash').flatMap((w) => w.items);
    const run = Trash.toTrash(items);
    let emptied = 0;
    const e = list.find((w) => w.how === 'empty');
    if (e) { if (Trash.empty()) emptied = e.size; else run.skipped.push({ path: 'the Trash', why: "it couldn't be emptied" }); }
    this.result = { run, emptied, total: run.bytes + emptied };
    this.mode = 'done';
    this.react(this.result.total ? 'done' : 'oops');
    this.disk = Look.disk();
    this.wins = Look.wins();
    Look.measure(this.wins, { signal: this.ac.signal, onOne: () => this.dirty() });
    this.dirty();
  }

  trashOne(item) {
    if (!Look.safe(item.path)) return this.say("roomy only moves things inside your home folder.", 'warn');
    this.mode = 'confirm';
    this.confirm = { kind: 'one', item, text: `Move ${item.name} (${size(item.size)}) to the Trash?` };
    this.dirty();
  }

  putBack() {
    try {
      const r = Trash.putBack();
      this.say(`Put back ${r.back.length} ${r.back.length === 1 ? 'thing' : 'things'}${r.stuck.length ? `; ${r.stuck.length} couldn't be (${r.stuck[0].why})` : ''}${r.finder.length ? '. The rest went through Finder: open the Trash and use Put Back' : ''}.`, 'ok', 8000);
      this.react('idle');
    } catch (e) { this.say(e.message, 'warn'); }
    this.disk = Look.disk();
    this.wins = Look.wins();
    Look.measure(this.wins, { signal: this.ac.signal, onOne: () => this.dirty() });
    if (this.tab === 'big') this.openDir(this.dir);
    this.mode = 'main';
  }

  // ── keys ──
  onKey(s, k) {
    if (k.name === 'enter') k = { ...k, name: 'return' };
    if (k.ctrl && (k.name === 'c' || k.name === 'd')) return this.quit();
    if (k.ctrl && k.name === 't') { Th.use(Th.name() === 'pool' ? 'shore' : 'pool'); this.ui.setPaper(Th.t().paper); return this.dirty(); }
    if (this.mode === 'confirm') {
      const c = this.confirm;
      if (s === 'y' || s === 'Y') {
        this.mode = 'main';
        if (c.kind === 'clean') this.doClean();
        else {
          const r = Trash.toTrash([c.item]);
          if (r.moved.length || r.byFinder.length) { this.say(`Moved ${c.item.name} to the Trash. u puts it back.`, 'ok'); this.react('done'); }
          else this.say(`Couldn't move it: ${(r.skipped[0] || {}).why || 'unknown'}.`, 'err');
          this.disk = Look.disk();
          this.openDir(this.dir);
        }
      } else if (s === 'n' || s === 'N' || k.name === 'escape' || k.name === 'return') { this.mode = 'main'; this.say('Nothing was changed.'); }
      return this.dirty();
    }
    if (this.mode === 'done') {
      if (s === 'u') this.putBack();
      else if (k.name === 'return' || s === 'q' || k.name === 'escape') return this.quit();
      else if (s === 'b' || k.name === 'left') this.mode = 'main';
      return this.dirty();
    }
    if (s === 'q' || k.name === 'escape') return this.quit();
    if (s === 'u') { this.putBack(); return this.dirty(); }
    if (k.name === 'tab' || (this.tab === 'wins' && k.name === 'right') || (this.tab === 'big' && k.name === 'left' && this.dir === Look.HOME())) {
      this.tab = this.tab === 'wins' ? 'big' : 'wins';
      if (this.tab === 'big' && !this.list) this.openDir(this.dir);
      return this.dirty();
    }
    if (this.tab === 'wins') {
      if (k.name === 'up') this.sel = Math.max(0, this.sel - 1);
      else if (k.name === 'down') this.sel = Math.min(this.wins.length - 1, this.sel + 1);
      else if (s === ' ') { const w = this.wins[this.sel]; if (w) w.on = !w.on; }
      else if (s === 'o') { const w = this.wins[this.sel]; const p = w && (w.items && w.items[0] ? path.dirname(w.items[0].path) : w.paths && w.paths[0]); if (p) openThing(p); }
      else if (k.name === 'return') this.clean();
      return this.dirty();
    }
    // biggest folders
    const list = this.list || [];
    const it = list[this.bigSel];
    if (k.name === 'up') this.bigSel = Math.max(0, this.bigSel - 1);
    else if (k.name === 'down') this.bigSel = Math.min(list.length - 1, this.bigSel + 1);
    else if (k.name === 'pageup') this.bigSel = Math.max(0, this.bigSel - 10);
    else if (k.name === 'pagedown') this.bigSel = Math.min(list.length - 1, this.bigSel + 10);
    else if ((k.name === 'return' || k.name === 'right') && it && it.dir) { this.trail.push({ dir: this.dir, from: it.path }); this.openDir(it.path); }
    else if ((k.name === 'left' || k.name === 'backspace') && this.dir !== Look.HOME()) { const back = this.trail.pop(); this.openDir(back ? back.dir : path.dirname(this.dir)); }
    else if (s === 'o' && it) openThing(it.dir ? it.path : path.dirname(it.path));
    else if ((s === 't' || s === 'd') && it) this.trashOne(it);
    return this.dirty();
  }

  // ── drawing ──
  frame(W, H) {
    const t = Th.t();
    const out = [];
    const d = this.disk;
    const facts = d ? `${size(d.free)} free of ${size(d.total)}` : '';
    out.push(spread(' ' + A.paint('roomy', { bold: true, fg: t.coral }) + '   ' + Th.dim('makes room on your computer') + (facts ? Th.faint('  ·  ') + A.paint(facts, { fg: t.sand }) : ''), Th.faint(pkg.version + ' '), W));
    out.push(Th.faint('─'.repeat(W)));
    // Shelly, and how full the disk is
    const pic = Shelly.draw(this.mood.scene, Date.now() - this.mood.at, t.paper.bg);
    const right = [];
    if (d) {
      const full = d.used / d.total;
      const bw = Math.max(10, Math.min(48, W - Shelly.WIDTH - 22));
      const n = Math.round(full * bw);
      const col = full > 0.9 ? t.err : full > 0.75 ? t.warn : t.sea;
      right.push(A.paint('█'.repeat(n), { fg: col }) + A.paint('█'.repeat(bw - n), { fg: t.line }) + '  ' + A.paint(`${Math.round(full * 100)}% full`, { bold: true, fg: col }));
    }
    const tb = this.tickedBytes();
    if (this.mode === 'done') right.push('');
    else if (this.tab === 'wins') right.push(this.measuring() && !tb ? Th.dim('Looking for space you can get back…') : A.paint(tb ? `The ticked things below give back ${size(tb)}.` : 'Tick what to clear with Space.', { fg: t.paper.fg }) + (this.measuring() ? Th.faint('  (still looking…)') : ''));
    else right.push(Th.dim('Your biggest folders. Enter looks inside, t moves one to the Trash.'));
    const top = [];
    for (let i = 0; i < Math.max(pic.length, 3); i++) top.push('  ' + (pic[i] || ' '.repeat(Shelly.WIDTH)) + '   ' + (i === Math.floor(pic.length / 2) - 1 ? right[0] || '' : i === Math.floor(pic.length / 2) ? right[1] || '' : ''));
    out.push(...top, '');
    const bodyH = Math.max(3, H - out.length - 3);
    const body = this.mode === 'done' ? this.doneLines(W) : this.tab === 'wins' ? this.winLines(W, bodyH) : this.bigLines(W, bodyH);
    while (body.length < bodyH) body.push('');
    out.push(...body.slice(0, bodyH).map((l) => A.clip(l, W)));
    out.push(Th.faint('─'.repeat(W)));
    out.push(' ' + A.clip(this.statusLine(W), W - 2));
    out.push(this.keyBar(W));
    return { lines: out.slice(0, H) };
  }

  tabs() {
    const t = Th.t();
    const one = (id, label) => (this.tab === id ? A.paint(` ${label} `, { bg: t.select, fg: t.coral, bold: true }) : A.paint(` ${label} `, { fg: t.dim }));
    return '  ' + one('wins', 'Easy wins') + ' ' + one('big', 'Biggest folders');
  }

  winLines(W) {
    const t = Th.t();
    const out = [this.tabs(), ''];
    const nameW = Math.min(46, Math.max(...this.wins.map((w) => w.name.length)) + 2);
    this.wins.forEach((w, i) => {
      const cur = i === this.sel;
      const dot = w.on ? A.paint('●', { fg: w.how === 'empty' ? t.coral : t.kelp }) : Th.faint('○');
      const sz = w.size === null ? Th.faint(SPIN[Math.floor(Date.now() / 160) % 4] + ' measuring') : w.size ? A.paint(size(w.size).padStart(9), { fg: t.sand, bold: cur }) : Th.faint('   nothing');
      const name = A.paint(w.name.padEnd(nameW), cur ? { bold: true, fg: t.paper.fg } : { fg: w.size === 0 ? t.faint : t.paper.fg });
      out.push((cur ? Th.coral(' › ') : '   ') + dot + ' ' + name + sz + (w.private ? Th.faint('  (macOS keeps its size private)') : ''));
      if (cur) {
        for (const l of A.wrap(w.why, Math.max(30, Math.min(80, W - 10)))) out.push('       ' + Th.dim(l));
        if (w.items && w.items.length) out.push('       ' + Th.faint(`${w.items.length} ${w.items.length === 1 ? 'thing' : 'things'}, biggest: ${tilde(w.items[0].path)} (${size(w.items[0].size)})`));
      }
    });
    return out;
  }

  bigLines(W, H) {
    const t = Th.t();
    const out = [this.tabs(), ''];
    out.push('  ' + A.paint(tilde(this.dir), { bold: true, fg: t.sea }) + (this.dir !== Look.HOME() ? Th.faint('   ← back') : ''));
    if (!this.list) { out.push('  ' + Th.dim(SPIN[Math.floor(Date.now() / 160) % 4] + ' measuring…')); return out; }
    if (!this.list.length) { out.push('  ' + Th.dim('This folder is empty.')); return out; }
    const max = this.list[0].size || 1;
    const rows = H - out.length;
    const top = Math.max(0, Math.min(this.bigSel - Math.floor(rows / 2), this.list.length - rows));
    const nameW = Math.min(36, Math.max(12, W - 40));
    for (let i = top; i < Math.min(this.list.length, top + rows); i++) {
      const x = this.list[i];
      const cur = i === this.bigSel;
      const bw = 16;
      const n = Math.max(x.size ? 1 : 0, Math.round((x.size / max) * bw));
      out.push((cur ? Th.coral(' › ') : '   ') + fit(A.paint(x.name + (x.dir ? '/' : ''), cur ? { bold: true, fg: t.paper.fg } : { fg: x.dir ? t.paper.fg : t.dim }), nameW) + ' ' + A.paint('■'.repeat(n), { fg: cur ? t.coral : t.sea }) + A.paint('■'.repeat(bw - n), { fg: t.line }) + '  ' + A.paint(size(x.size).padStart(9), { fg: t.sand }));
    }
    return out;
  }

  doneLines(W) {
    const t = Th.t();
    const r = this.result;
    const out = [];
    if (r.total) out.push('  ' + A.paint(`Done! You got back ${size(r.total)}.`, { bold: true, fg: t.ok }));
    else out.push('  ' + A.paint('Nothing was cleared.', { bold: true, fg: t.warn }));
    out.push('');
    if (r.run.moved.length || r.run.byFinder.length) out.push('  ' + Th.dim(`${r.run.moved.length + r.run.byFinder.length} things went to the Trash. Changed your mind? Press u and they go back.`));
    if (r.emptied) out.push('  ' + Th.dim(`The Trash was emptied (${size(r.emptied)}).`));
    if (r.run.skipped.length) {
      out.push('', '  ' + Th.warn(`${r.run.skipped.length} stayed where ${r.run.skipped.length === 1 ? 'it was' : 'they were'}:`));
      for (const s of r.run.skipped.slice(0, 4)) out.push('    ' + Th.dim(`${A.clip(tilde(s.path), 46)}: ${s.why}`));
    }
    if (r.run.moved.length || r.run.byFinder.length) out.push('', '  ' + Th.faint('To really free the space, empty the Trash later (roomy can do it too).'));
    return out;
  }

  statusLine(W) {
    const t = Th.t();
    if (this.mode === 'confirm') return A.paint(this.confirm.text, { bold: true, fg: t.warn }) + Th.dim('  y yes · n no');
    if (this.flash) return A.paint(this.flash.text, { fg: t[this.flash.kind] || t.dim });
    if (this.mode === 'done') return Th.dim('Press Enter to close roomy.');
    if (this.tab === 'wins') {
      const b = this.tickedBytes();
      return b ? A.paint(`Press Enter to clear ${size(b)}.`, { bold: true, fg: t.paper.fg }) + Th.dim(W > 90 ? '  Things go to the Trash first, and u puts them back.' : '  u puts it back.') : Th.dim('Only clears things that come back by themselves, or that you threw away.');
    }
    return Th.dim('roomy only touches things inside your home folder, and only moves them to the Trash.');
  }

  keyBar(W) {
    const t = Th.t();
    let keys;
    if (this.mode === 'confirm') keys = [['y', 'yes', true], ['n', 'no']];
    else if (this.mode === 'done') keys = [['enter', 'all done', true], ['u', 'put it all back'], ['b', 'back']];
    else if (this.tab === 'wins') { const b = this.tickedBytes(); keys = [...(b ? [['enter', `clear ${size(b)}`, true]] : []), ['space', 'tick'], ['↑↓', 'choose'], ['→', 'biggest folders'], ['u', 'put back'], ['q', 'quit']]; }
    else keys = [['enter', 'look inside', true], ['←', 'back'], ['t', 'to the Trash'], ['o', 'show in Finder'], ['tab', 'easy wins'], ['q', 'quit']];
    const chip = ([key, label, main]) => (main ? A.paint(` ${key} `, { bg: t.coral, fg: t.paper.bg, bold: true }) + ' ' + A.paint(label, { bold: true }) : A.paint(key, { fg: t.sand }) + ' ' + Th.dim(label));
    let parts = keys.map(chip);
    while (parts.length > 1 && A.vwidth(' ' + parts.join('   ')) > W) parts = parts.slice(0, -1);
    return ' ' + parts.join('   ');
  }
}

module.exports = { App };
