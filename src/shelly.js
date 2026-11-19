'use strict';
// Shelly, roomy's hermit crab. She knows all about moving to a roomier home.

const S = require('./sprite');

const BASE = [
  '....................',
  '...K...K............',
  '...R...R....SSSSS...',
  '...R...R...SSsssSS..',
  '....R.R...SSsSSSsSS.',
  '.CC..RR..SSsSsssSsS.',
  'CCCC.RRRRSSsSsSSsSS.',
  '.CCRRRRRRSSsSSssSSS.',
  '..CRRRRRRRSSsssSSS..',
  '...RRRRRRRRSSSSSS...',
  '...R.R.R.R..........',
  '..R..R..R..R........',
];
const MINI = [
  '.K.K........',
  '.R.R..SSSS..',
  '..RR.SSssSS.',
  'CC.RRSsSSsS.',
  'CCRRRRSssSS.',
  '.RRRRRSSSS..',
  '.R.R.R......',
];
const INK = { K: '#1b1410', R: '#e5553b', C: '#f07a52', S: '#e3c08f', s: '#9a6a44' };

const blink = (g) => g.map((r) => r.replace(/K/g, 'R'));
const snap = (g) => g.map((r) => r.replace(/^(\.?)CC/, '$1.C').replace(/^CCCC/, '.CCC')); // a claw clicks
const hop = (g) => [g[0].replace(/./g, '.')].concat(g.slice(0, g.length - 1));
const sad = (g) => g.map((r, y) => (y === 0 ? r.replace(/K/g, '.') : y === 1 && r.includes('K') ? r : r));
const f = (grid, ms) => ({ grid, ms });
const scenes = (g) => ({
  idle: [f(g, 1600), f(blink(g), 150), f(g, 1300), f(snap(g), 220), f(g, 260), f(snap(g), 220)],
  work: [f(snap(g), 180), f(g, 180)],
  done: [f(hop(g), 220), f(g, 220), f(hop(g), 220), f(g, 1800)],
  oops: [f(sad(g), 1400), f(blink(g), 160)],
});
const SCENES = scenes(BASE);
const MINI_SCENES = scenes(MINI);

function frame(scene, ms) {
  const set = S.style() === 'blocky' ? MINI_SCENES : SCENES;
  const frames = set[scene] || set.idle;
  const total = frames.reduce((n, x) => n + x.ms, 0);
  let at = ms % total;
  for (const fr of frames) { if (at < fr.ms) return fr.grid; at -= fr.ms; }
  return frames[0].grid;
}

function draw(scene = 'idle', ms = 0, bg = null) {
  const g = frame(scene, ms);
  return S.style() === 'blocky' ? S.drawBlocky(g, INK, { bg }) : S.draw(g, INK, { bg });
}

module.exports = { draw, BASE, MINI, INK, get WIDTH() { return S.size(BASE, MINI).w; }, get HEIGHT() { return S.size(BASE, MINI).h; } };
