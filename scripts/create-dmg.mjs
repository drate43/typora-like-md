import { spawnSync } from 'node:child_process';
import {
  existsSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const tauriDir = path.join(rootDir, 'src-tauri');
const configPath = path.join(tauriDir, 'tauri.conf.json');
const packagePath = path.join(rootDir, 'package.json');

const tauriConfig = JSON.parse(readFileSync(configPath, 'utf8'));
const packageConfig = JSON.parse(readFileSync(packagePath, 'utf8'));

const productName = tauriConfig.productName;
const version = tauriConfig.version ?? packageConfig.version;

function readTarget() {
  if (process.env.MARKVIEW_DMG_TARGET) return process.env.MARKVIEW_DMG_TARGET;

  const targetIndex = process.argv.indexOf('--target');
  if (targetIndex !== -1) return process.argv[targetIndex + 1] ?? '';

  const targetArg = process.argv.find((arg) => arg.startsWith('--target='));
  return targetArg ? targetArg.slice('--target='.length) : '';
}

function archFromTarget(target) {
  if (target.startsWith('aarch64-')) return 'aarch64';
  if (target.startsWith('x86_64-')) return 'x86_64';
  if (target === 'universal-apple-darwin') return 'universal';
  return null;
}

function archFromProcess() {
  if (process.arch === 'arm64') return 'aarch64';
  if (process.arch === 'x64') return 'x86_64';
  return process.arch;
}

const target = readTarget();
const archName = archFromTarget(target) ?? archFromProcess();
const releaseDir = target
  ? path.join(tauriDir, 'target', target, 'release')
  : path.join(tauriDir, 'target', 'release');
const bundleDir = path.join(releaseDir, 'bundle');
const appPath = path.join(bundleDir, 'macos', `${productName}.app`);
const dmgDir = path.join(bundleDir, 'dmg');
const dmgPath = path.join(dmgDir, `${productName}_${version}_${archName}.dmg`);
const stagedAppPath = path.join(productName, `${productName}.app`);
const productVolumePath = path.join('/Volumes', productName);
const documentIconFile = 'markview-document.icns';

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
}

function tryRun(command, args) {
  spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'ignore',
  });
}

function tryRunVisible(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
  });

  return result.status === 0;
}

function readPlistArrayCount(plistPath, keyPath) {
  const result = spawnSync('plutil', ['-extract', keyPath, 'raw', plistPath], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  if (result.status !== 0) return 0;
  const count = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(count) ? count : 0;
}

function setPlistString(plistPath, keyPath, value) {
  if (tryRunVisible('plutil', ['-replace', keyPath, '-string', value, plistPath])) {
    return;
  }

  run('plutil', ['-insert', keyPath, '-string', value, plistPath]);
}

function applyDocumentTypeIcon(appBundlePath) {
  const resourcesDir = path.join(appBundlePath, 'Contents', 'Resources');
  const infoPlistPath = path.join(appBundlePath, 'Contents', 'Info.plist');
  const sourceIconPath = path.join(tauriDir, 'icons', 'icon.icns');
  const targetIconPath = path.join(resourcesDir, documentIconFile);
  const documentTypeCount = readPlistArrayCount(infoPlistPath, 'CFBundleDocumentTypes');

  if (documentTypeCount === 0) return;

  copyFileSync(sourceIconPath, targetIconPath);

  for (let index = 0; index < documentTypeCount; index += 1) {
    setPlistString(
      infoPlistPath,
      `CFBundleDocumentTypes.${index}.CFBundleTypeIconFile`,
      documentIconFile
    );
  }
}

function sleep(seconds) {
  spawnSync('sleep', [String(seconds)], {
    cwd: rootDir,
    stdio: 'ignore',
  });
}

function createWritableImage(imagePath) {
  const attempts = [
    ['APFS', ['create', '-size', '128m', '-fs', 'APFS', '-volname', productName, '-ov', imagePath]],
    ['HFS+', ['create', '-size', '128m', '-fs', 'HFS+', '-volname', productName, '-ov', imagePath]],
  ];

  for (const [label, args] of attempts) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      rmSync(imagePath, { force: true });
      if (tryRunVisible('hdiutil', args)) return;
      console.warn(`hdiutil create failed with ${label} (attempt ${attempt}/3).`);
      sleep(1);
    }
  }

  throw new Error('hdiutil create failed');
}

if (!existsSync(appPath)) {
  console.error(`Missing app bundle: ${appPath}`);
  console.error(
    target
      ? `Run \`tauri build --target ${target} --bundles app\` before creating the DMG.`
      : 'Run `tauri build --bundles app` before creating the DMG.'
  );
  process.exit(1);
}

if (process.platform !== 'darwin') {
  console.error('DMG creation is only supported on macOS.');
  process.exit(1);
}

mkdirSync(dmgDir, { recursive: true });
rmSync(dmgPath, { force: true });

if (existsSync(productVolumePath)) {
  tryRun('hdiutil', ['detach', productVolumePath]);
}

const tempRoot = process.platform === 'darwin' && existsSync('/private/tmp') ? '/private/tmp' : tmpdir();
const tempDir = mkdtempSync(path.join(tempRoot, 'markview-dmg-'));
const stagingDir = path.join(tempDir, productName);
const mountDir = path.join(tempDir, 'mount');
const tempImagePath = path.join(tempDir, `${productName}.rw.dmg`);
let mounted = false;

try {
  applyDocumentTypeIcon(appPath);
  mkdirSync(stagingDir);
  mkdirSync(mountDir);
  run('ditto', [appPath, path.join(tempDir, stagedAppPath)]);
  symlinkSync('/Applications', path.join(stagingDir, 'Applications'));

  run('chmod', ['-R', 'u+rwX,go+rX', stagingDir]);
  run('xattr', ['-cr', stagingDir]);
  run('codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    '--timestamp=none',
    path.join(tempDir, stagedAppPath),
  ]);
  run('codesign', [
    '--verify',
    '--deep',
    '--strict',
    '--verbose=2',
    path.join(tempDir, stagedAppPath),
  ]);

  createWritableImage(tempImagePath);
  run('hdiutil', [
    'attach',
    '-nobrowse',
    '-mountpoint',
    mountDir,
    tempImagePath,
  ]);
  mounted = true;
  run('ditto', [stagingDir, mountDir]);
  run('hdiutil', ['detach', mountDir]);
  mounted = false;

  run('hdiutil', [
    'convert',
    tempImagePath,
    '-format',
    'UDZO',
    '-imagekey',
    'zlib-level=9',
    '-o',
    dmgPath,
  ]);

  console.log(`Created DMG: ${dmgPath}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (mounted) tryRun('hdiutil', ['detach', mountDir]);
  rmSync(tempDir, { recursive: true, force: true });
}
