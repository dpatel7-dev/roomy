'use strict';
const LightDark = require('./lightdark'); // light or dark for every app, set in pca
// roomy's colours: a tide pool. "pool" is dark, "shore" is light.

const A = require('./ansi');

const THEMES = {
  pool: {
    paper: { bg: '#0f1a1e', fg: '#e4eeea' },
    dim: '#8aa3a0', faint: '#4d6466', line: '#24363a', select: '#172a2e',
    coral: '#ff7a59', sand: '#e8c9a0', sea: '#5cc8c0', kelp: '#8fc26a', sun: '#f2c14e', shell: '#c9a27a', ok: '#8fc26a', warn: '#f2c14e', err: '#ff6b6b',
  },
  shore: {
    paper: { bg: '#eef5f3', fg: '#16282b' },
    dim: '#5a7472', faint: '#a8bcb9', line: '#d3e1de', select: '#dfece9',
    coral: '#d24a2a', sand: '#9a6a2e', sea: '#13827a', kelp: '#4a7a22', sun: '#9a6a00', shell: '#8a6038', ok: '#3a7a1a', warn: '#9a6a00', err: '#c0392b',
  },
};
let current = THEMES.pool;
let name = 'pool';
// light or dark for every app is set in pca: Shore when it's light, Pool when it's dark
function use(n) { n = LightDark.pick(THEMES[n] ? n : 'pool', { light: 'shore', dark: 'pool', isLight: (x) => x === 'shore' }); name = THEMES[n] ? n : 'pool'; current = THEMES[name]; return current; }
const t = () => current;
const c = (key) => (s, extra = {}) => A.paint(s, { fg: current[key], ...extra });

module.exports = {
  THEMES, use, t, name: () => name,
  dim: c('dim'), faint: c('faint'), coral: c('coral'), sand: c('sand'), sea: c('sea'), kelp: c('kelp'), sun: c('sun'), ok: c('ok'), warn: c('warn'), err: c('err'),
};
