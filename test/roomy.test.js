'use strict';
// roomy's tests, in a pretend home folder: what it finds, what it refuses,
// and that everything it clears can go back.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roomy-test-'));
const H = path.join(tmp, 'home');
process.env.ROOMY_TARGET_HOME = H;
process.env.ROOMY_HOME = path.join(tmp, 'roomy');
process.env.ROOMY_OS = 'linux';

const Look = require('../src/look');
const Trash = require('../src/trash');

const put = (rel, bytes, daysOld = 0) => {
  const p = path.join(H, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(bytes, 7));
  if (daysOld) { const t = new Date(Date.now() - daysOld * 864e5); fs.utimesSync(p, t, t); }
  return p;
};

test('finds the easy wins, and nothing it should leave alone', async () => {
  put('Downloads/old-setup.dmg', 300000, 60);
  put('Downloads/new-setup.dmg', 300000);
  put('Downloads/photo.jpg', 300000, 90);
  put('.cache/thumbnails/a.png', 200000);
  put('.cache/pip/wheels/x.whl', 100000);
  put('code/old/package.json', 10, 200);
  put('code/old/node_modules/lib/index.js', 120000);
  fs.utimesSync(path.join(H, 'code/old'), new Date(Date.now() - 200 * 864e5), new Date(Date.now() - 200 * 864e5));
  put('code/new/package.json', 10);
  put('code/new/node_modules/lib/index.js', 120000);
  fs.symlinkSync('/etc', path.join(H, '.cache', 'sneaky'));
  const wins = Look.wins();
  await Look.measure(wins);
  const by = Object.fromEntries(wins.map((w) => [w.id, w]));
  assert.deepStrictEqual(by.installers.items.map((x) => path.basename(x.path)), ['old-setup.dmg'], 'only old installers');
  assert.deepStrictEqual(by.caches.items.map((x) => path.basename(x.path)), ['thumbnails'], 'pip is counted with package downloads, links are skipped');
  assert.ok(by.packages.items.some((x) => x.path.endsWith('.cache/pip')));
  assert.deepStrictEqual(by.node.items.map((x) => path.relative(H, x.path)), ['code/old/node_modules'], 'only old projects');
  assert.strictEqual(wins[wins.length - 1].id, 'trash', 'emptying the Trash comes last');
  assert.strictEqual(by.trash.on, false, 'and is never ticked for you');
});

test('never touches anything outside your home folder, or through a link', () => {
  assert.strictEqual(Look.safe('/etc/hosts'), false);
  assert.strictEqual(Look.safe(H), false);
  assert.strictEqual(Look.safe(path.join(H, '.cache', 'sneaky')), false);
  const r = Trash.toTrash([{ path: '/etc/hosts', size: 1 }]);
  assert.strictEqual(r.moved.length, 0);
  assert.match(r.skipped[0].why, /home folder/);
});

test('clearing moves things to the Trash, and putting back brings them home', () => {
  const a = put('Downloads/older.pkg', 5000, 90);
  const b = put('.cache/stuff/c.bin', 7000);
  const r = Trash.toTrash([{ path: a, size: 5000 }, { path: path.dirname(b), size: 7000 }]);
  assert.strictEqual(r.moved.length, 2);
  assert.strictEqual(r.bytes, 12000);
  assert.ok(!fs.existsSync(a) && !fs.existsSync(b));
  const tdir = Look.trashDir();
  assert.ok(fs.existsSync(path.join(tdir, 'older.pkg')), 'in the Trash');
  assert.match(fs.readFileSync(path.join(path.dirname(tdir), 'info', 'older.pkg.trashinfo'), 'utf8'), /Path=.*older\.pkg/, 'with the note file managers use for Restore');
  const back = Trash.putBack();
  assert.strictEqual(back.back.length, 2);
  assert.ok(fs.existsSync(a) && fs.existsSync(b), 'everything is back');
  assert.throws(() => Trash.putBack(), /nothing to put back/);
});

test('the same name twice in the Trash keeps both', () => {
  const one = put('x/notes.txt', 10);
  Trash.toTrash([{ path: one, size: 10 }]);
  const two = put('y/notes.txt', 10);
  const r = Trash.toTrash([{ path: two, size: 10 }]);
  assert.match(path.basename(r.moved[0].to), /^notes 2\.txt$/);
});

test('emptying the Trash', async () => {
  assert.ok(Trash.empty());
  assert.deepStrictEqual(fs.readdirSync(Look.trashDir()), []);
});
