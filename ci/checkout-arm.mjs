import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, openSync, closeSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seal } from './diagnostics.mjs';

const automation = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = process.env.GITHUB_WORKSPACE;
const source = path.join(workspace, 'source');
const auth = path.join(process.env.RUNNER_TEMP, 'glinkbot-source-auth');
const keyFile = path.join(auth, 'source-key');
const hostsFile = path.join(auth, 'known-hosts');
const log = path.join(auth, 'checkout.log');
const config = JSON.parse(readFileSync(path.join(automation, 'release.json'), 'utf8'));
const childEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
for (const name of ['SOURCE_DEPLOY_KEY', 'GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_OUTPUT', 'GITHUB_ENV', 'GITHUB_PATH', 'GITHUB_STEP_SUMMARY']) delete childEnv[name];
function git(args, env = {}) {
  const fd = openSync(log, 'a', 0o600);
  try {
    const result = spawnSync('git', args, { cwd: source, env: { ...childEnv, ...env }, stdio: ['ignore', fd, fd] });
    if (result.error || result.status !== 0) throw new Error('Private checkout git command failed');
  } finally { closeSync(fd); }
}
try {
  assert.equal(process.platform, 'win32');
  assert.equal(process.arch, 'arm64');
  assert.equal(process.env.GITHUB_REPOSITORY, 'ESCANOR-001/forge-5fd711b48340');
  assert.equal(process.env.GITHUB_ACTOR, 'ESCANOR-001');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(config.repository, 'ESCANOR-001/glinkbot');
  assert.match(config.commit, /^[a-f0-9]{40}$/);
  assert(process.env.SOURCE_DEPLOY_KEY);
  // This directory has already passed the owner-only Windows ACL probe.
  writeFileSync(keyFile, process.env.SOURCE_DEPLOY_KEY.trim() + '\n', { mode: 0o600, flag: 'wx' });
  delete process.env.SOURCE_DEPLOY_KEY;
  // Authenticate GitHub host keys over HTTPS, never disable SSH host checking.
  const response = await fetch('https://api.github.com/meta', { signal: AbortSignal.timeout(30000) });
  assert(response.ok);
  const metadata = await response.json();
  assert(Array.isArray(metadata.ssh_keys) && metadata.ssh_keys.length > 0);
  assert(metadata.ssh_keys.every(key => /^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp256) [A-Za-z0-9+/=]+$/.test(key)));
  writeFileSync(hostsFile, metadata.ssh_keys.map(key => `github.com ${key}\n`).join(''), { mode: 0o600, flag: 'wx' });
  mkdirSync(source); // Fail rather than overwrite any existing checkout.
  git(['init']);
  git(['remote', 'add', 'origin', `git@github.com:${config.repository}.git`]);
  const ssh = `${process.env.WINDIR}/System32/OpenSSH/ssh.exe`.replaceAll('\\', '/');
  const quote = value => { assert(!/["\r\n$`]/.test(value)); return `"${value.replaceAll('\\', '/')}"`; };
  git(['fetch', '--no-tags', '--depth=1', 'origin', config.commit], {
    GIT_SSH_COMMAND: `${quote(ssh)} -i ${quote(keyFile)} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${quote(hostsFile)}`,
  });
  git(['checkout', '--detach', config.commit]);
  console.log('Private source checkout completed; temporary authentication removed.');
} catch (error) {
  try {
    appendFileSync(log, `\n${error.stack}\n`, { mode: 0o600 });
    const diagnostics = path.join(workspace, 'diagnostics');
    mkdirSync(diagnostics, { recursive: true });
    writeFileSync(path.join(diagnostics, 'win32-arm64.sealed.json'), seal(readFileSync(log), readFileSync(path.join(automation, 'diagnostics-public.pem'))));
  } catch { /* No plaintext fallback. */ }
  console.error('Private checkout failed; inspect encrypted diagnostics locally.');
  process.exitCode = 1;
} finally {
  for (const file of [keyFile, hostsFile]) rmSync(file, { force: true });
}
