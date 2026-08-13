import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const readJson = (relative) => JSON.parse(readFileSync(path.join(root, relative), 'utf8'));
const policy = readJson('packages/contracts/release-policy.json');
const packageJson = readJson('package.json');
const companion = readJson('apps/companion/package.json');
const failures = [];

for (const field of ['signatureRequired', 'macNotarizationRequired', 'sbomRequired', 'artifactManifestRequired']) {
  if (policy.distribution?.[field] !== true) failures.push(`Distribution policy ${field} must remain enabled.`);
}
for (const field of [
  'signatureVerificationRequired', 'migrationBackupRequired', 'rollbackCandidateRequired',
  'lastKnownGoodRequired', 'stagedRolloutRequired', 'preserveModelDirectories',
]) {
  if (policy.updates?.[field] !== true) failures.push(`Update policy ${field} must remain enabled.`);
}
if (policy.updates?.automaticUpdatesEnabled !== false) {
  failures.push('Automatic updates must stay disabled until an updater enforces the signed staging policy.');
}
const stableTargets = new Set((policy.supportedMatrix ?? [])
  .filter((target) => target.support === 'stable')
  .map((target) => `${target.platform}/${target.architecture}`));
for (const target of ['macos/arm64', 'windows/x64']) {
  if (!stableTargets.has(target)) failures.push(`Stable native target ${target} is missing.`);
}
if (packageJson.dependencies?.sharp !== '0.35.3' || !packageJson.dependencies?.['@jitsi/robotjs']) {
  failures.push('Desktop native runtime dependencies must stay in dependencies, not devDependencies.');
}
for (const [script, architecture] of [['dist:mac', '--arm64'], ['dist:win', '--x64'], ['dist:linux', '--x64']]) {
  if (!packageJson.scripts?.[script]?.includes(architecture)) failures.push(`Desktop ${script} must pin ${architecture}.`);
  if (!companion.scripts?.[script]?.includes(architecture)) failures.push(`Companion ${script} must pin ${architecture}.`);
}
for (const name of ['sharp', '@jitsi/robotjs', 'screenshot-desktop']) {
  if (!companion.dependencies?.[name]) failures.push(`Companion runtime dependency ${name} is misplaced.`);
}
if (companion.build?.nsis?.deleteAppDataOnUninstall !== false) failures.push('Companion uninstall must preserve user data.');
const builder = readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
for (const expectation of [
  'notarize: true', 'hardenedRuntime: true', 'deleteAppDataOnUninstall: false',
  'artifact-manifest.json', 'sbom.cdx.json',
]) {
  if (!builder.includes(expectation)) failures.push(`Desktop builder is missing ${expectation}.`);
}
const rendererFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'app', 'frontend'], { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/)
  .filter((relative) => /\.(?:js|jsx|ts|tsx)$/.test(relative))
  // --cached still lists files deleted in the working tree; reading one
  // throws and fails the gate for an unrelated reason.
  .filter((relative) => existsSync(path.join(root, relative)));
const legacyStorageReaders = new Set([
  'frontend/lib/serverSettings.ts',
  'frontend/components/JarvisAssistant.tsx',
  'frontend/components/wizards/HomeAssistantWizard.tsx',
  'frontend/components/pages/CalendarPage.tsx',
  'frontend/components/pages/HomeAssistantPage.tsx',
]);
// Files ported from upstream JarvisV5 (the 2026-08 overhaul merge) that keep
// per-device renderer state — HUD layouts, timers, todos, lock flag,
// onboarding progress — in localStorage the way upstream shipped them.
// Accepted as visible debt: migrating them to Core storage is tracked
// follow-up work, and none of them stores credentials (the lock PIN is
// stored only as a hash). Reads and writes are both exempt for these files;
// do NOT add new files here for any other reason.
const portedUpstreamStateFiles = new Set([
  'app/page.tsx',
  'app/round/page.tsx',
  'frontend/components/AmbientMode.tsx',
  'frontend/components/CommandPalette.tsx',
  'frontend/components/HUD/HUDLayer.tsx',
  'frontend/components/HUD/widgets/AgendaWidget.tsx',
  'frontend/components/HUD/widgets/TodoWidget.tsx',
  'frontend/components/LockScreen.tsx',
  'frontend/components/OnboardingWizard.tsx',
  'frontend/components/pages/AudioTestPage.tsx',
  'frontend/components/pages/OnewheelPage.tsx',
  'frontend/components/pages/SocialMediaPage.tsx',
  'frontend/components/pages/SpidermanPage.tsx',
  'frontend/components/pages/WebFluidFormulaLab.tsx',
  'frontend/lib/functions.ts',
  'frontend/lib/timers.ts',
]);
// A write that strips secrets out of a legacy document is the opposite of
// storing durable state, so it is exempt when annotated at the call site.
// Marking the line rather than the file keeps the exemption from silently
// widening to future writes in the same file.
const REDACTION_MARKER = 'legacy-redaction';
for (const relative of rendererFiles) {
  const source = readFileSync(path.join(root, relative), 'utf8');
  const writes = source.split(/\r?\n/)
    .filter((line) => /\blocalStorage\.setItem\s*\(/.test(line) && !line.includes(REDACTION_MARKER));
  if (writes.length && !portedUpstreamStateFiles.has(relative)) failures.push(`${relative} writes durable renderer state to localStorage.`);
  if (/\blocalStorage\b/.test(source) && !legacyStorageReaders.has(relative) && !portedUpstreamStateFiles.has(relative)) failures.push(`${relative} introduced an unapproved localStorage reader.`);
}

if (failures.length) {
  console.error('Release policy validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Release policy passed for macOS arm64, Windows x64, and experimental Linux x64.');
}
