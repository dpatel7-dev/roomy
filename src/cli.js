'use strict';
// roomy's commands.

const os = require('os');
const path = require('path');
const A = require('./ansi');
const Look = require('./look');
const Trash = require('./trash');
const { size } = require('./tui');
const pkg = require('../package.json');

const say = (s = '') => process.stdout.write(s + '\n');
const HELP = `
  roomy ${pkg.version} - makes room on your computer, safely

  roomy                 open roomy: see what's using space, tick what to clear, press Enter
  roomy check           just list what could be cleared (changes nothing)
  roomy putback         put the last things roomy cleared back where they were
  roomy update          get the newest roomy
  roomy uninstall       remove roomy (add --all to remove its history too)
  roomy --version       which roomy this is

  roomy moves things to the Trash (so you can change your mind), only inside your
  home folder, and only things that come back by themselves or that you threw away.
`;

async function check() {
  const d = Look.disk();
  if (d) say(`\n  ${A.paint('roomy', { bold: true })}  ${size(d.free)} free of ${size(d.total)} (${Math.round((d.used / d.total) * 100)}% full)\n`);
  const wins = Look.wins();
  await Look.measure(wins);
  let total = 0;
  for (const w of wins) {
    say(`  ${(w.size ? size(w.size) : '-').padStart(9)}  ${w.name}${w.private ? ' (size private)' : ''}`);
    total += w.size || 0;
  }
  say(`\n  Up to ${size(total)} could be cleared. Run ${A.paint('roomy', { bold: true })} to choose.\n`);
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  const life = require('./life')({ name: 'roomy', cmd: 'roomy', repo: 'dpatel7-dev/roomy', home: Trash.home });
  if (process.platform === 'win32' && !['--version', '-v', 'version', 'help', '--help', '-h', 'update', 'uninstall'].includes(cmd)) {
    throw new Error("roomy works on Macs and Linux for now. On Windows, open Settings > System > Storage and turn on Storage Sense.");
  }
  switch (cmd) {
    case '--version': case '-v': case 'version': say(`roomy ${pkg.version}`); return;
    case 'help': case '--help': case '-h': say(HELP); return;
    case 'update': return life.update();
    case 'uninstall': return life.uninstall(rest.includes('--all'));
    case 'check': case 'list': return check();
    case 'putback': case 'undo': {
      const r = Trash.putBack();
      say(`\n  Put back ${r.back.length} ${r.back.length === 1 ? 'thing' : 'things'}.${r.stuck.length ? ` ${r.stuck.length} couldn't be (${r.stuck[0].why}).` : ''}${r.finder.length ? ' Some went through Finder: open the Trash and choose Put Back.' : ''}\n`);
      return;
    }
    case undefined: {
      if (!process.stdin.isTTY || !process.stdout.isTTY) { say(HELP); return; }
      const { App } = require('./app');
      await new App().run();
      return;
    }
    default: throw new Error(`roomy doesn't know "${cmd}". Type roomy help to see what it can do.`);
  }
}

module.exports = { main, HELP };
