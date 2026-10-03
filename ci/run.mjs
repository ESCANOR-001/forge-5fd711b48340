import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, openSync, closeSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seal } from './diagnostics.mjs';

const automation = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = process.env.GITHUB_WORKSPACE;
const source = path.join(workspace, 'source');
const log = path.join(process.env.RUNNER_TEMP, 'private-build.log');
const config = JSON.parse(readFileSync(path.join(automation, 'release.json'), 'utf8'));
const target = process.env.BUILD_TARGET ?? 'prerequisites';
const targets = {
  'linux-x64': { os: 'ubuntu-24.04', arch: 'x64', resources: 'release/linux-unpacked/resources' },
  'darwin-x64': { os: 'macos-15-intel', arch: 'x64', resources: 'release/mac/GlinkBot.app/Contents/Resources' },
  'darwin-arm64': { os: 'macos-15', arch: 'arm64', resources: 'release/mac-arm64/GlinkBot.app/Contents/Resources' },
  'win32-x64': { os: 'windows-2025', arch: 'x64', resources: 'release/win-unpacked/resources' },
  'win32-arm64': { os: 'windows-11-arm', arch: 'arm64', resources: 'release/win-arm64-unpacked/resources' },
};
const baseEnv = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false', CI: 'true' };
// Children cannot accidentally write to public workflow command/summary channels.
for (const name of ['GITHUB_OUTPUT', 'GITHUB_ENV', 'GITHUB_PATH', 'GITHUB_STEP_SUMMARY', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'SOURCE_DEPLOY_KEY', 'GH_TOKEN', 'GITHUB_TOKEN']) delete baseEnv[name];
const r2Env = () => ({ R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY });
async function stage(label, command, env = {}) {
  console.log(`Starting: ${label}`);
  appendFileSync(log, `\n--- ${label} ---\n`, { mode: 0o600 });
  const fd = openSync(log, 'a', 0o600);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', command], {
        cwd: source, env: { ...baseEnv, ...env }, stdio: ['ignore', fd, fd],
      });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Stage failed: ${label}`)));
    });
  } finally { closeSync(fd); }
  console.log(`Passed: ${label}`);
}
function validateSource() {
  assert.equal(process.env.GITHUB_REPOSITORY, 'ESCANOR-001/forge-5fd711b48340');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
  assert.equal(process.env.GITHUB_ACTOR, 'ESCANOR-001');
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.match(config.commit, /^[a-f0-9]{40}$/);
  assert.match(config.version, /^\d+\.\d+\.\d+$/);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(), config.commit);
  assert.equal(JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8')).version, config.version);
}
async function main() {
  validateSource();
  if (process.argv[2] === 'prerequisites') {
    assert(process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY, 'R2 credentials required');
    await stage('Publisher dependencies', 'npm ci --prefix tools/desktop-release --ignore-scripts --no-audit --no-fund');
    await stage('R2 access and public download check', 'node tools/desktop-release/check-access.mjs', r2Env());
    return;
  }
  assert(Object.hasOwn(targets, target), 'Unsupported target');
  assert(['build', 'publish'].includes(process.argv[2]), 'Unsupported mode');
  const spec = targets[target];
  const resources = path.join(source, spec.resources);
  if (process.argv[2] === 'build') {
  await stage('Install pinned dependencies', 'pnpm install --frozen-lockfile');
  await stage('Distribution policy and Electron checks', 'pnpm test:distribution && pnpm check:electron');
  await stage('Publisher dependencies and tests', 'npm ci --prefix tools/desktop-release --ignore-scripts --no-audit --no-fund && node --test tools/desktop-release/publish.test.mjs');
  if (target === 'linux-x64') {
    await stage('Linux validation dependencies', 'sudo apt-get update && sudo apt-get install -y squashfs-tools desktop-file-utils xvfb dbus-x11 libxi6 libxkbcommon0 at-spi2-core x11-utils xdotool');
    await stage('Build Linux DEB and AppImage', 'pnpm package:linux');
    await stage('Check Linux package structure', 'node scripts/verify-linux-package.mjs');
    await stage('Install and test on disposable Linux runner', 'sudo chmod 0755 /opt && sudo apt-get install -y ./release/GlinkBot-*-amd64.deb && node scripts/smoke-browser-bundle.mjs --resources /opt/GlinkBot/resources');
    await stage('Installed Linux server smoke', 'node scripts/smoke-packaged-server.mjs --browser-bundle /opt/GlinkBot/resources/browser-engine', { OMB_SMOKE_DIST: '/opt/GlinkBot/resources/server' });
    await stage('Linux desktop startup and cleanup smoke', 'sudo chown root:root release/linux-unpacked/chrome-sandbox && sudo chmod 4755 release/linux-unpacked/chrome-sandbox && pnpm smoke:linux-package', { OMB_SMOKE_INSTALLED_DEB: '1' });
  } else if (target === 'win32-x64') {
    await stage('Build Windows x64 EXE and ZIP', 'pnpm package:win');
  } else if (target === 'win32-arm64') {
    assert.equal(process.arch, 'arm64');
    await stage('Build Windows ARM64 EXE and ZIP', 'pnpm package:prepare && pnpm build:cua:win && pnpm exec electron-builder --win nsis:arm64 zip:arm64 --publish never \'-c.nsis.artifactName=GlinkBot-${version}-arm64-setup.${ext}\'');
    await stage('Windows ARM64 native host smoke', '\"$GITHUB_WORKSPACE/source/release/win-arm64-unpacked/GlinkBot.exe\" scripts/smoke-cua-win-embedded.mjs', { ELECTRON_RUN_AS_NODE: '1', GLINKBOT_CUA_SMOKE_RESOURCES: resources, GLINKBOT_CUA_SMOKE_ARCH: 'arm64' });
  } else {
    await stage('Build macOS DMG and ZIP (ad-hoc)', `pnpm package:prepare && pnpm build:speech && pnpm build:cua && pnpm exec electron-builder --mac --${spec.arch} --publish never -c.mac.identity=- -c.dmg.sign=false`, { GLINKBOT_CUA_ARCHES: spec.arch, GLINKBOT_CUA_ARCHES_PARTIAL: '1' });
  }
  if (target !== 'linux-x64') {
    await stage('Packaged browser smoke', 'node scripts/smoke-browser-bundle.mjs --resources "$PACKAGE_RESOURCES"', { PACKAGE_RESOURCES: resources });
    await stage('Packaged server smoke', 'node scripts/smoke-packaged-server.mjs --browser-bundle "$PACKAGE_RESOURCES/browser-engine"', { PACKAGE_RESOURCES: resources, OMB_SMOKE_DIST: path.join(resources, 'server') });
  }
  await stage('Packaged updater policy', 'node scripts/check-packaged-update-target.mjs "$PACKAGE_RESOURCES/app-update.yml"', { PACKAGE_RESOURCES: resources });
    return;
  }
  assert(process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY, 'R2 credentials required');
  // The R2 immutable path must identify PRIVATE source, not this workflow's SHA.
  await stage('Publish approved installers and verify public bytes', 'node tools/desktop-release/publish.mjs release "$BUILD_TARGET"', { ...r2Env(), GITHUB_SHA: config.commit });
  const manifestUrl = `https://downloads.glinkbot.com/releases/${config.version}/${config.commit}/${target}/manifest.json`;
  const response = await fetch(manifestUrl, { signal: AbortSignal.timeout(30000) });
  assert(response.ok);
  const manifest = await response.json();
  assert.equal(manifest.commit, config.commit);
  assert.equal(manifest.version, config.version);
  assert.equal(manifest.target, target);
  assert.equal(manifest.autoUpdateFeedPublished, false);
  assert(manifest.files.length >= 2);
  console.log(`Verified release manifest: ${manifestUrl}`);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${target} — ${config.version}\n\n[Verified release manifest](${manifestUrl})\n\nInstallers uploaded. Update feed not activated. macOS: ad-hoc/not notarized; Windows: unsigned.\n`);
}
main().catch(error => {
  // Never put error.message/stack, child stdout, or raw logs into Actions output.
  try {
    appendFileSync(log, `\n${error.stack ?? error}\n`, { mode: 0o600 });
    const diagnostics = path.join(workspace, 'diagnostics');
    mkdirSync(diagnostics, { recursive: true });
    const safeTarget = Object.hasOwn(targets, target) ? target : 'prerequisites';
    writeFileSync(path.join(diagnostics, `${safeTarget}.sealed.json`), seal(readFileSync(log), readFileSync(path.join(automation, 'diagnostics-public.pem'))), { mode: 0o600 });
  } catch { /* Fail closed: no plaintext diagnostic fallback. */ }
  console.error('Build stopped. Raw diagnostics are not public; use the encrypted failure artifact.');
  process.exitCode = 1;
});
