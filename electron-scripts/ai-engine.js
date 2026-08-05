const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const serviceRoot = path.join(projectRoot, 'services', 'ai-engine');
const venvRoot = path.join(serviceRoot, '.venv');
const requirementsPath = path.join(serviceRoot, 'requirements-dev.txt');
const markerPath = path.join(venvRoot, '.jarvis-requirements.sha256');

function fail(message) {
  console.error(`[ai-engine] ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || projectRoot,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.error || result.status !== 0) {
    if (options.capture && result.stderr) process.stderr.write(result.stderr);
    fail(`Command failed: ${command} ${args.join(' ')}`);
  }
  return options.capture ? result.stdout.trim() : '';
}

function systemPython() {
  if (process.env.JARVIS_BUILD_PYTHON) return { command: process.env.JARVIS_BUILD_PYTHON, prefix: [] };
  const candidates = process.platform === 'win32'
    ? [{ command: 'python', prefix: [] }, { command: 'py', prefix: ['-3'] }, { command: 'python3', prefix: [] }]
    : [{ command: 'python3', prefix: [] }, { command: 'python', prefix: [] }];
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.prefix, '--version'], { stdio: 'ignore' });
    if (result.status === 0) return candidate;
  }
  fail('Python 3.12 was not found. Set JARVIS_BUILD_PYTHON to a Python executable.');
}

function venvPython() {
  return process.platform === 'win32'
    ? path.join(venvRoot, 'Scripts', 'python.exe')
    : path.join(venvRoot, 'bin', 'python');
}

function setup() {
  const system = systemPython();
  if (!fs.existsSync(venvPython())) {
    console.log(`[ai-engine] Creating ${path.relative(projectRoot, venvRoot)}`);
    run(system.command, [...system.prefix, '-m', 'venv', venvRoot]);
  }
  const pythonVersion = run(venvPython(), ['--version'], { capture: true });
  const requirementsHash = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(serviceRoot, 'requirements-runtime.txt')))
    .update(fs.readFileSync(requirementsPath))
    .update(pythonVersion)
    .digest('hex');
  const installedHash = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf8').trim() : '';
  if (installedHash !== requirementsHash) {
    run(venvPython(), ['-m', 'pip', 'install', '--disable-pip-version-check', '--requirement', requirementsPath], { cwd: serviceRoot });
    fs.writeFileSync(markerPath, `${requirementsHash}\n`, { encoding: 'utf8', mode: 0o600 });
  }
}

function test() {
  if (!fs.existsSync(venvPython())) fail('Run npm run ai:setup first.');
  run(venvPython(), ['-m', 'pytest', '-q'], {
    cwd: serviceRoot,
    env: { PYTHONPATH: serviceRoot },
  });
}

function build() {
  setup();
  const distRoot = path.join(serviceRoot, 'dist');
  const buildRoot = path.join(projectRoot, '.build', `ai-engine-${process.platform}-${process.arch}`);
  const separator = process.platform === 'win32' ? ';' : ':';
  fs.mkdirSync(distRoot, { recursive: true });
  run(venvPython(), [
    '-m', 'PyInstaller',
    '--noconfirm', '--clean', '--onedir', '--name', 'jarvis-ai-engine',
    '--paths', serviceRoot,
    '--add-data', `${path.join(serviceRoot, 'profiles')}${separator}profiles`,
    '--distpath', distRoot,
    '--workpath', path.join(buildRoot, 'work'),
    '--specpath', buildRoot,
    path.join(serviceRoot, 'entrypoint.py'),
  ]);
  const executable = path.join(
    distRoot,
    'jarvis-ai-engine',
    process.platform === 'win32' ? 'jarvis-ai-engine.exe' : 'jarvis-ai-engine',
  );
  if (!fs.existsSync(executable)) fail(`PyInstaller did not create ${executable}`);
  if (process.platform !== 'win32') fs.chmodSync(executable, 0o755);
  console.log(`[ai-engine] Ready: ${path.relative(projectRoot, executable)}`);
}

function dev() {
  setup();
  run(venvPython(), ['-m', 'jarvis_ai_engine.main'], {
    cwd: serviceRoot,
    env: { PYTHONPATH: serviceRoot },
  });
}

const mode = process.argv[2];
if (mode === 'setup') setup();
else if (mode === 'test') test();
else if (mode === 'build') build();
else if (mode === 'dev') dev();
else fail('Usage: node electron-scripts/ai-engine.js setup|test|build|dev');
