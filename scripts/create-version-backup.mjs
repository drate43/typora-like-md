import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = packageJson.version;
const backupRoot = path.join(rootDir, 'version-backups', version);

const rootFiles = [
  '.gitignore',
  'CHANGELOG.md',
  'MARKVIEW_INSTALL_GUIDE.md',
  'README.md',
  'index.html',
  'package-lock.json',
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
];

const pathsToCopy = [
  '.github',
  'public',
  'scripts',
  'src',
  'src-tauri/Cargo.lock',
  'src-tauri/Cargo.toml',
  'src-tauri/build.rs',
  'src-tauri/capabilities',
  'src-tauri/gen',
  'src-tauri/icons',
  'src-tauri/src',
  'src-tauri/tauri.conf.json',
];

function copyIfExists(relativePath) {
  const source = path.join(rootDir, relativePath);
  if (!existsSync(source)) return;

  const target = path.join(backupRoot, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

rmSync(backupRoot, { recursive: true, force: true });
mkdirSync(backupRoot, { recursive: true });

for (const file of rootFiles) {
  copyIfExists(file);
}

for (const sourcePath of pathsToCopy) {
  copyIfExists(sourcePath);
}

console.log(`Created version backup: ${path.relative(rootDir, backupRoot)}`);
