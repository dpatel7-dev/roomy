'use strict';
// A full-screen terminal app in one small class: it takes over the window,
// paints it in the app's own colours, reads keys, mouse and pastes, redraws only
// the lines that changed, and puts everything back exactly as it was on exit.
//
//   const ui = new Tui({ paper: { bg, fg }, render: (w, h) => ({ lines, cursor }) });
//   ui.on('key', (str, key) => ...); ui.on('paste', (text) => ...); ui.on('mouse', (m) => ...);
//   ui.start(); ... ui.schedule(); ... await ui.stop();

const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const readline = require('readline');
const A = require('./ansi');

const MOUSE_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
const COLOR_REPLY_RE = /\x1b\](1[01]);rgb:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})(?:\x07|\x1b\\)/gi;
const FOCUS_RE = /\x1b\[[IO]/g;
const hex2 = (h) => parseInt((h + h).slice(0, 2), 16);

let live = null; // the Tui on screen now (for the exit safety net)

class Tui extends EventEmitter {
  constructor({ input = process.stdin, output = process.stdout, paper = null, render, mouse = true } = {}) {
    super();
    this.input = input;
    this.output = output;
    this.paper = paper;
    this.render = render;
    this.mouse = mouse;
    this.prev = [];
    this.running = false;
    this.pending = false;
    this.pasting = false;
    this.pasteBuf = '';
    this.original = { 10: null, 11: null }; // the terminal's own colours, as it told us
    this.keys = new PassThrough();
    this._hooks = [];
  }

  get width() { return Math.max(20, this.output.columns || 80); }
  get height() { return Math.max(8, this.output.rows || 24); }

  start() {
    if (this.running) return;
    this.running = true;
    live = this;
    readline.emitKeypressEvents(this.keys, { escapeCodeTimeout: 50 });
    this._on(this.keys, 'keypress', (str, key) => this.emit('key', str, key || {}));
    if (this.input.setRawMode) this.input.setRawMode(true);
    this.input.resume();
    this._on(this.input, 'data', (d) => this._data(d));
    this._on(this.output, 'resize', () => { this.prev = []; this.output.write(this._ink() + '\x1b[2J'); this.schedule(); this.emit('resize'); });
    A.setPaper(this.paper);
    this.output.write('\x1b[?1049h' + '\x1b]10;?\x07\x1b]11;?\x07' + this._paperCodes() + this._ink() + '\x1b[2J\x1b[?2004h' + (this.mouse ? '\x1b[?1000h\x1b[?1006h' : ''));
    this.schedule();
  }

  /** Switch colours (a theme change): repaints the whole window. */
  setPaper(paper) {
    this.paper = paper;
    A.setPaper(paper);
    if (!this.running) return;
    this.prev = [];
    this.output.write(this._paperCodes() + this._ink() + '\x1b[2J');
    this.schedule();
  }

  schedule() {
    if (this.pending || !this.running) return;
    this.pending = true;
    setImmediate(() => { this.pending = false; this.flush(); });
  }

  flush() {
    if (!this.running) return;
    const W = this.width;
    const H = this.height;
    const { lines = [], cursor = null } = this.render(W, H) || {};
    let buf = '\x1b[?2026h\x1b[?25l';
    for (let y = 0; y < H; y++) {
      const line = lines[y] === undefined ? '' : lines[y];
      if (this.prev[y] === line) continue;
      buf += `\x1b[${y + 1};1H` + A.paperize(line + A.RESET) + '\x1b[K';
    }
    this.prev = lines.slice(0, H);
    if (cursor) buf += `\x1b[${cursor.row + 1};${cursor.col + 1}H\x1b[?25h`;
    this.output.write(buf + '\x1b[?2026l');
  }

  /** Leave: give the terminal back exactly as it was. */
  stop() {
    if (!this.running) return;
    this.running = false;
    for (const [em, ev, fn] of this._hooks) em.removeListener(ev, fn);
    this._hooks = [];
    this.output.write(this._restoreCodes() + (this.mouse ? '\x1b[?1000l\x1b[?1006l' : '') + '\x1b[?2004l\x1b[?25h\x1b[?1049l');
    A.setPaper(null);
    try { if (this.input.setRawMode) this.input.setRawMode(false); } catch { /* not a terminal any more */ }
    this.input.pause();
    if (live === this) live = null;
  }

  /** Run something that needs the normal terminal (an installer, an editor), then come back. */
  async suspend(fn) {
    this.stop();
    try { return await fn(); } finally { this.start(); }
  }

  // ── input ──────────────────────────────────────────────────────────────────
  _data(d) {
    let s = d.toString('utf8');
    // the terminal answering "what colours do you have?"
    s = s.replace(COLOR_REPLY_RE, (all, which, r, g, b) => {
      const hex = '#' + [r, g, b].map((v) => hex2(v).toString(16).padStart(2, '0')).join('');
      const ours = this.paper && hex === String(which === '11' ? this.paper.bg : this.paper.fg).toLowerCase();
      if (!ours) this.original[which] = hex;
      return '';
    });
    s = s.replace(FOCUS_RE, '');
    while (s) {
      if (this.pasting) {
        const end = s.indexOf('\x1b[201~');
        if (end < 0) { this.pasteBuf += s; return; }
        this.pasteBuf += s.slice(0, end);
        const text = this.pasteBuf.replace(/\r\n?/g, '\n');
        this.pasting = false;
        this.pasteBuf = '';
        this.emit('paste', text);
        s = s.slice(end + 6);
        continue;
      }
      const start = s.indexOf('\x1b[200~');
      const keys = start < 0 ? s : s.slice(0, start);
      if (keys) this._keys(keys);
      if (start < 0) return;
      this.pasting = true;
      s = s.slice(start + 6);
    }
  }

  _keys(s) {
    s = s.replace(MOUSE_RE, (all, b, x, y, m) => {
      const btn = Number(b);
      if (btn === 64 || btn === 65) this.emit('mouse', { wheel: btn === 64 ? -1 : 1, x: Number(x) - 1, y: Number(y) - 1 });
      else if (m === 'M' && (btn & 3) === 0 && btn < 32) this.emit('mouse', { click: true, x: Number(x) - 1, y: Number(y) - 1 });
      return '';
    });
    if (s) this.keys.write(s);
  }

  // ── colours ────────────────────────────────────────────────────────────────
  _paperCodes() {
    return this.paper && A.getLevel() > 0 ? `\x1b]10;${this.paper.fg}\x07\x1b]11;${this.paper.bg}\x07` : '';
  }

  _ink() {
    const p = A.getPaper();
    return p ? p.on : '';
  }

  _restoreCodes() {
    if (!this.paper || A.getLevel() === 0) return '\x1b[0m';
    let out = '\x1b[0m\x1b]110\x07\x1b]111\x07';
    if (this.original[10]) out += `\x1b]10;${this.original[10]}\x07`;
    if (this.original[11]) out += `\x1b]11;${this.original[11]}\x07`;
    return out;
  }

  _on(em, ev, fn) {
    em.on(ev, fn);
    this._hooks.push([em, ev, fn]);
  }
}

// However the program ends, never leave the terminal taken over.
process.on('exit', () => {
  if (!live) return;
  try { require('fs').writeSync(1, live._restoreCodes() + '\x1b[?1000l\x1b[?1006l\x1b[?2004l\x1b[?25h\x1b[?1049l'); } catch { /* gone */ }
});

// ── layout helpers ─────────────────────────────────────────────────────────────

/** Exactly w columns: clipped or padded with spaces. */
function fit(str, w) {
  if (w <= 0) return '';
  const [text, used] = A.clipW(String(str), w);
  return used < w ? text + ' '.repeat(w - used) : text;
}

function center(str, w) {
  const vw = A.vwidth(str);
  if (vw >= w) return A.clip(str, w);
  const left = Math.floor((w - vw) / 2);
  return ' '.repeat(left) + str + ' '.repeat(w - vw - left);
}

/** Right-align `right` against `left` in w columns. */
function spread(left, right, w) {
  const lw = A.vwidth(left);
  const rw = A.vwidth(right);
  if (lw + rw + 1 > w) return fit(left, w);
  return left + ' '.repeat(w - lw - rw) + right;
}

/** "1.4 MB" */
function size(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)).replace(/\.0+$|(\.\d*?)0+$/, '$1') + ' ' + u[i];
}

/** "5m ago" */
function ago(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  if (s < 86400 * 30) return Math.round(s / 86400) + 'd ago';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** A bar of w cells, filled to `part` (0..1). */
function bar(part, w, on = '█', off = '░') {
  const n = Math.max(0, Math.min(w, Math.round(part * w)));
  return on.repeat(n) + off.repeat(w - n);
}

/** Copy text to the clipboard: the system's tool if there is one, else ask the terminal (OSC 52). */
function copy(text, output = process.stdout) {
  const { spawnSync } = require('child_process');
  const tries = process.platform === 'darwin' ? [['pbcopy', []]]
    : process.platform === 'win32' ? [['clip', []]]
      : [['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]];
  for (const [cmd, args] of tries) {
    try {
      const r = spawnSync(cmd, args, { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: 3000 });
      if (r.status === 0) return true;
    } catch { /* try the next */ }
  }
  output.write(`\x1b]52;c;${Buffer.from(text).toString('base64')}\x07`);
  return true;
}

/** Open a file, folder or web address with whatever the system uses. */
function open(target) {
  if (process.env.TUI_NO_OPEN === '1') return false;
  const { spawn } = require('child_process');
  const [cmd, args] = process.platform === 'darwin' ? ['open', [target]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', target]]
      : ['xdg-open', [target]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    return true;
  } catch { return false; }
}

module.exports = { Tui, fit, center, spread, size, ago, bar, copy, open };
