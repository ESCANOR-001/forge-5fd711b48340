# Desktop release orchestration

This public repository contains only the build orchestration for GlinkBot.
Application source remains in a separate private repository. A random repository
name is not a privacy measure: this workflow and its limited status logs are public.

## Release targets

| Platform | Packages |
| --- | --- |
| Linux x64 | DEB and AppImage |
| macOS Intel x64 | DMG and ZIP |
| macOS Apple Silicon arm64 | DMG and ZIP |
| Windows x64 | EXE and ZIP |
| Windows ARM64 | EXE and ZIP |

Only standard GitHub-hosted runners are used. macOS builds are ad-hoc signed and
not notarized; Windows builds are unsigned. This workflow does not enroll in
signing services, change billing, install apps on personal devices, deploy a
website, or activate an automatic-update feed.

## Maintainer setup

- `SOURCE_DEPLOY_KEY`: a read-only SSH deploy key limited to the private source repo.
- `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`: Object Read & Write credentials
  limited to the existing `glinkbot-downloads` bucket.
- `release.json`: reviewed, immutable full source commit and expected version.

Run `desktop.yml` manually from `main`, choosing all targets or one failed target.
Only the owning maintainer may execute this workflow. There are no push, PR,
fork, schedule, or repository-dispatch triggers. Source credentials are removed
after checkout; upload credentials are supplied only to the R2 check/upload steps.

Builds validate artifacts and upload only allowlisted installers, their blockmaps,
and release manifests to immutable commit-specific paths at downloads.glinkbot.com.
They never upload source trees, unpacked applications, source maps, or plain logs.
Existing release paths cannot be overwritten with different package bytes.

## Public-log precautions

Raw compiler, package-manager and test output is buffered in private runner files,
not streamed to public Actions logs. No Actions dependency/source caches are used.
On failure only, diagnostics are AES-256-GCM encrypted with an independently random
key, wrapped with RSA-OAEP-SHA256 using `diagnostics-public.pem`, before artifact
upload. The corresponding private key is held outside both Git repositories on
the maintainer's computer. Encrypted diagnostics expire after three days.
Never add a private key to this repository. Do not enable Actions debug logging.

These precautions limit accidental disclosure; they are not a guarantee against
malicious trusted source or dependencies. Review source revisions and dependencies
before changing `release.json`, and never execute untrusted PR code with secrets.

Public files are audited separately from private application source. `ci/run.mjs`
must never echo child-process output or exception stacks into the public log.
