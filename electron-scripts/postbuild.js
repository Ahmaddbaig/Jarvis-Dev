const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const standaloneRoot = path.join(projectRoot, '.next', 'standalone');
const serverPath = path.join(standaloneRoot, 'server.js');
const forbiddenRootFiles = [
  '.bambu-token.json',
  '.jarvis-desktop-token',
  'credentials.json',
  'jarvis-chrome-control.json',
  'jarvis-companions.json',
  'jarvis-server-settings.json',
];

function fail(message) {
  console.error(`[postbuild] ${message}`);
  process.exit(1);
}

function replaceDirectory(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
}

function copyFile(source, destination, required = true) {
  if (!fs.existsSync(source)) {
    if (required) fail(`Missing required file: ${path.relative(projectRoot, source)}`);
    return;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function removeLocalState() {
  for (const name of fs.readdirSync(standaloneRoot)) {
    const isEnvironmentFile = name === '.env' || name.startsWith('.env.');
    const isPrivateKey = /\.(?:key|pem|p12|pfx)$/i.test(name);
    if (forbiddenRootFiles.includes(name) || isEnvironmentFile || isPrivateKey) {
      fs.rmSync(path.join(standaloneRoot, name), { recursive: true, force: true });
    }
  }

  const leaked = fs.readdirSync(standaloneRoot).filter((name) => {
    return forbiddenRootFiles.includes(name) || name === '.env' || name.startsWith('.env.');
  });
  if (leaked.length > 0) fail(`Refusing to package local state: ${leaked.join(', ')}`);
}

if (!fs.existsSync(serverPath)) {
  fail('Next standalone server is missing. Run `npm run build:next` before postbuild.');
}

replaceDirectory(path.join(projectRoot, 'public'), path.join(standaloneRoot, 'public'));
replaceDirectory(path.join(projectRoot, '.next', 'static'), path.join(standaloneRoot, '.next', 'static'));

const packagedScripts = path.join(standaloneRoot, 'scripts');
fs.rmSync(packagedScripts, { recursive: true, force: true });
copyFile(
  path.join(projectRoot, 'scripts', 'computer_use.py'),
  path.join(packagedScripts, 'computer_use.py'),
);

const helperName = process.platform === 'win32' ? 'computer_use.exe' : 'computer_use';
copyFile(
  path.join(projectRoot, 'scripts', 'dist', helperName),
  path.join(packagedScripts, 'dist', helperName),
);

removeLocalState();

console.log('[postbuild] Assembled .next/standalone for Electron resources/app');
