import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncVersion } from './sync-version.mjs';

function fixture(t, version = '1.2.3') {
  const root = mkdtempSync(join(tmpdir(), 'easygit-version-'));
  t.after(() => {
    const target = resolve(root);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith('easygit-version-'));
    rmSync(target, { recursive: true, force: true });
  });
  mkdirSync(join(root, 'src-tauri'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'easygit', version }));
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ version: '0.1.0', packages: { '': { version: '0.1.0' }, dependency: { version: '9.9.9' } } }));
  writeFileSync(join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: '0.1.0', identifier: 'dev.esaygit.desktop' }));
  writeFileSync(join(root, 'src-tauri/Cargo.toml'), '[package]\nname = "easygit"\nversion = "0.1.0"\n[dependencies]\nserde = "1"\n[dependencies.other]\nversion = "9.9.9"\n');
  writeFileSync(join(root, 'src-tauri/Cargo.lock'), 'version = 4\n[[package]]\nname = "easygit"\nversion = "0.1.0"\n[[package]]\nname = "other"\nversion = "9.9.9"\n');
  return root;
}
test('syncs only application versions and is idempotent', t => {
  const root = fixture(t);
  assert.equal(syncVersion(root).changed.length, 4);
  assert.deepEqual(syncVersion(root, true), { version: '1.2.3', changed: [] });
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages[''].version, '1.2.3'); assert.equal(lock.packages.dependency.version, '9.9.9');
  assert.match(readFileSync(join(root, 'src-tauri/Cargo.toml'), 'utf8'), /\[dependencies.other\]\nversion = "9.9.9"/);
  assert.match(readFileSync(join(root, 'src-tauri/Cargo.lock'), 'utf8'), /name = "other"\nversion = "9.9.9"/);
});
test('check mode refuses mismatches without writing', t => {
  const root = fixture(t);
  const path = join(root, 'src-tauri/tauri.conf.json'); const before = readFileSync(path, 'utf8');
  assert.throws(() => syncVersion(root, true), /Versions differ/); assert.equal(readFileSync(path, 'utf8'), before);
});
test('validates semantic versions before any writes', t => {
  for (const version of ['01.2.3', '1.2', '1.2.3-extra.01', '1.2.3 trailing', '1.2.3\n', 'v1.2.3']) assert.throws(() => syncVersion(fixture(t, version)), /valid semantic version/);
  assert.equal(syncVersion(fixture(t, '1.2.3-beta.1+build.42')).version, '1.2.3-beta.1+build.42');
});
test('release workflow references an existing npm script in package.json', () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const workflow = readFileSync(join(repoRoot, '.github/workflows/release.yml'), 'utf8');
  const match = /^\s*tauriScript:\s*npm\s+run\s+([^\s]+)\s*$/m.exec(workflow);
  assert.ok(match, 'release.yml must declare tauriScript: npm run <script>');
  assert.ok(pkg.scripts?.[match[1]], `package.json is missing script "${match[1]}" required by release.yml`);
});
