const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(projectRoot, 'scripts', 'computer_use.py');
const requirementsPath = path.join(projectRoot, 'scripts', 'computer-use-requirements.txt');
const buildRoot = path.join(projectRoot, '.build', `python-${process.platform}-${process.arch}`);
const venvRoot = path.join(buildRoot, 'venv');
const distRoot = path.join(projectRoot, 'scripts', 'dist');
const executableName = process.platform === 'win32' ? 'computer_use.exe' : 'computer_use';
const outputPath = path.join(distRoot, executableName);

function fail(message) {
  console.error(`[build-python] ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.error || result.status !== 0) {
    if (options.capture && result.stderr) process.stderr.write(result.stderr);
    fail(`Command failed: ${command} ${args.join(' ')}`);
  }
  return options.capture ? result.stdout.trim() : '';
}

function pythonCommand() {
  if (process.env.JARVIS_BUILD_PYTHON) {
    return { command: process.env.JARVIS_BUILD_PYTHON, prefix: [] };
  }
  const candidates = process.platform === 'win32'
    ? [{ command: 'python', prefix: [] }, { command: 'py', prefix: ['-3'] }, { command: 'python3', prefix: [] }]
    : [{ command: 'python3', prefix: [] }, { command: 'python', prefix: [] }];
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.prefix, '--version'], {
      cwd: projectRoot,
      env: process.env,
      stdio: 'ignore',
    });
    if (result.status === 0) return candidate;
  }
  fail('Python 3 was not found. Set JARVIS_BUILD_PYTHON to a Python 3 executable.');
}

function venvPython() {
  return process.platform === 'win32'
    ? path.join(venvRoot, 'Scripts', 'python.exe')
    : path.join(venvRoot, 'bin', 'python');
}

function assertNativeBinary(filePath) {
  if (!fs.existsSync(filePath)) fail(`PyInstaller did not create ${filePath}`);
  const bytes = fs.readFileSync(filePath);
  const isElf = bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  const isPe = bytes[0] === 0x4d && bytes[1] === 0x5a;
  const magic = bytes.readUInt32BE(0);
  const isMachO = [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(magic);
  const matchesHost = process.platform === 'darwin' ? isMachO : process.platform === 'win32' ? isPe : isElf;
  if (!matchesHost) fail(`Generated helper is not a native ${process.platform} executable: ${filePath}`);

  let detectedArch = 'unknown';
  if (isMachO && ![0xcafebabe, 0xbebafeca].includes(magic)) {
    const littleEndian = magic === 0xcefaedfe || magic === 0xcffaedfe;
    const cpuType = littleEndian ? bytes.readUInt32LE(4) : bytes.readUInt32BE(4);
    detectedArch = cpuType === 0x0100000c ? 'arm64' : cpuType === 0x01000007 ? 'x64' : 'unknown';
  } else if (isElf) {
    const machine = bytes[5] === 1 ? bytes.readUInt16LE(18) : bytes.readUInt16BE(18);
    detectedArch = machine === 183 ? 'arm64' : machine === 62 ? 'x64' : 'unknown';
  } else if (isPe) {
    const peOffset = bytes.readUInt32LE(0x3c);
    const machine = bytes.readUInt16LE(peOffset + 4);
    detectedArch = machine === 0xaa64 ? 'arm64' : machine === 0x8664 ? 'x64' : 'unknown';
  }
  if (detectedArch !== 'unknown' && detectedArch !== process.arch) {
    fail(`Generated helper architecture is ${detectedArch}; expected ${process.arch}`);
  }
  if (process.platform !== 'win32') fs.chmodSync(filePath, 0o755);
}

if (!fs.existsSync(sourcePath)) fail(`Missing helper source: ${sourcePath}`);
if (!fs.existsSync(requirementsPath)) fail(`Missing pinned requirements: ${requirementsPath}`);

const systemPython = pythonCommand();
run(systemPython.command, [...systemPython.prefix, '--version']);

fs.mkdirSync(buildRoot, { recursive: true });
if (!fs.existsSync(venvPython())) {
  console.log(`[build-python] Creating isolated build environment at ${venvRoot}`);
  run(systemPython.command, [...systemPython.prefix, '-m', 'venv', venvRoot]);
}

const pythonVersion = run(venvPython(), ['--version'], { capture: true });
const requirementsHash = crypto
  .createHash('sha256')
  .update(fs.readFileSync(requirementsPath))
  .update(pythonVersion)
  .digest('hex');
const markerPath = path.join(buildRoot, 'requirements.sha256');
const installedHash = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf8').trim() : '';

if (installedHash !== requirementsHash) {
  console.log('[build-python] Installing pinned build dependencies');
  run(venvPython(), ['-m', 'pip', 'install', '--disable-pip-version-check', '--requirement', requirementsPath]);
  fs.writeFileSync(markerPath, `${requirementsHash}\n`, 'utf8');
}

fs.mkdirSync(distRoot, { recursive: true });
for (const staleName of ['computer_use', 'computer_use.exe']) {
  const stalePath = path.join(distRoot, staleName);
  if (fs.existsSync(stalePath)) fs.rmSync(stalePath, { force: true });
}

console.log(`[build-python] Building ${process.platform}/${process.arch} helper`);
run(venvPython(), [
  '-m', 'PyInstaller',
  '--noconfirm',
  '--clean',
  '--onefile',
  '--name', 'computer_use',
  '--distpath', distRoot,
  '--workpath', path.join(buildRoot, 'work'),
  '--specpath', buildRoot,
  sourcePath,
]);

assertNativeBinary(outputPath);
console.log(`[build-python] Ready: ${path.relative(projectRoot, outputPath)}`);
