import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function syncVersion(root, checkOnly = false) {
  const read = path => readFileSync(resolve(root, path), 'utf8');
  const version = JSON.parse(read('package.json')).version;
  const numeric = '(0|[1-9]\\d*)';
  const match = typeof version === 'string' && new RegExp(`^${numeric}\\.${numeric}\\.${numeric}(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`).exec(version);
  if (!match || match[0] !== version || match[4]?.split('.').some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) {
    throw new Error('package.json version must be a valid semantic version.');
  }
  const edits = [];
  const jsonVersion = (path, update) => {
    if (!existsSync(resolve(root, path))) return;
    const value = JSON.parse(read(path));
    const before = JSON.stringify(value);
    update(value);
    if (before !== JSON.stringify(value)) edits.push([path, `${JSON.stringify(value, null, 2)}\n`]);
  };
  jsonVersion('src-tauri/tauri.conf.json', value => { value.version = version; });
  jsonVersion('package-lock.json', value => { value.version = version; if (value.packages?.['']) value.packages[''].version = version; });
  const updateSection = (path, delimiter, isPackage) => {
    if (!existsSync(resolve(root, path))) return;
    let found = false;
    const before = read(path);
    const after = before.split(delimiter).map(section => {
      if (!isPackage(section)) return section;
      if (!/^version\s*=\s*"[^"]+"/m.test(section)) throw new Error(`${path}: package version is missing.`);
      found = true;
      return section.replace(/^(version\s*=\s*")[^"]+(".*)$/m, (_match, prefix, suffix) => `${prefix}${version}${suffix}`);
    }).join('');
    if (!found) throw new Error(`${path}: easygit package section is missing.`);
    if (before !== after) edits.push([path, after]);
  };
  updateSection('src-tauri/Cargo.toml', /(?=^\[[^\]]+\])/m, section => section.startsWith('[package]'));
  updateSection('src-tauri/Cargo.lock', /(?=^\[\[package\]\])/m, section => /^name\s*=\s*"easygit"\s*$/m.test(section));
  if (checkOnly && edits.length) throw new Error(`Versions differ from package.json (${version}): ${edits.map(([path]) => path).join(', ')}. Run npm run sync:version.`);
  for (const [path, content] of edits) writeFileSync(resolve(root, path), content, 'utf8');
  return { version, changed: edits.map(([path]) => path) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = syncVersion(resolve(dirname(fileURLToPath(import.meta.url)), '..'), process.argv.includes('--check'));
    console.log(`easygit v${result.version}${result.changed.length ? `: synced ${result.changed.join(', ')}` : ': versions match'}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
