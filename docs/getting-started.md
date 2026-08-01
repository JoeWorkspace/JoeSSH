# Getting Started

> **Release status:** JoeSSH does not yet provide a signed public installer.
> Repository workflows currently produce unsigned staging bundles for review
> and installation testing only; do not redistribute them as public release
> artifacts. Run the native Desktop app from source to use real SSH today.

## Prerequisites

Use the toolchain versions pinned by this repository:

- Node.js `22.22.2`
- npm `10.9.7`
- Rust `1.96.0`
- NASM available on `PATH` for the native Rust crypto build

Install the operating-system dependencies in the official
[Tauri 2 prerequisites guide](https://v2.tauri.app/start/prerequisites/). Follow
the section for your platform, including its compiler, WebView, and other
system-package requirements.

### Windows 10/11 x64

Windows is the primary Public Beta target. Install these components before
building JoeSSH:

- [Git](https://git-scm.com/downloads) and Node.js `22.22.2`
- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
  with the **Desktop development with C++** workload
- [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
- Rust through [rustup](https://rustup.rs/)
- [NASM](https://www.nasm.us/) with its executable directory on `PATH`

Pin npm and install the repository Rust toolchain after those installers
finish:

```powershell
npm install --global npm@10.9.7
rustup toolchain install 1.96.0 --profile minimal --component rustfmt --component clippy
```

On macOS or Linux, install the matching compiler, WebView, and system packages
from the Tauri prerequisites guide. Public signed/notarized packages are not
available for those platforms yet either.

Confirm the main tools before installing dependencies:

```bash
node --version
npm --version
rustc --version
nasm -v
```

## Get The Source

Clone the public repository and install its locked dependency graph:

```bash
git clone https://github.com/JoeWorkspace/JoeSSH.git
cd JoeSSH
npm ci
```

If the repository is already checked out, run only `npm ci` from its root.

## Run The Native Desktop App

From the repository root, start Tauri:

```bash
npm exec --workspace @atlasterm/desktop -- tauri dev
```

The Tauri window is the supported development path for real SSH, terminal,
SFTP, and port-forwarding operations.

For UI-only work, start the browser preview instead:

```bash
npm run dev:desktop
```

The browser preview uses demo data because it has no native IPC connection to
the Rust SSH engine. It cannot establish a real SSH session or validate real
authentication, host-key, SFTP, terminal, or port-forwarding behavior.

## Make Your First SSH Connection

1. Start the native Desktop app, then select **New**.
2. Enter a connection name and host. Add the port (SSH defaults to `22`),
   username, group, or tags as needed, then select **Create connection**.
3. Select the saved connection and choose **Connect**.
4. Confirm the host, port, and username. Choose **Password** or **Private key**
   authentication, enter the requested credential, and select **Connect**.
5. For an unknown host, JoeSSH presents its SHA-256 host-key fingerprint before
   authentication. Compare it through a second trusted channel, such as the
   server console, the host administrator, or a previously published
   fingerprint. Select **Trust and connect** only after the values match.
6. A changed stored host key is blocked. Stop and investigate the server or key
   rotation through a trusted channel; never clear or replace the stored key
   merely to bypass the warning.
7. After the session connects, use the central terminal workspace and the
   **SFTP** and **Port Forwarding** panels for the live host.

Treat passwords, private keys, and passphrases as local secrets. Do not paste
them into issues, logs, screenshots, or shared configuration.

## Sync Confidentiality

Public Beta Sync authenticates requests but stores submitted JSON payloads
without end-to-end encryption. Never place SSH private keys, passwords, bearer
tokens, terminal output, or other secrets in Sync payloads. Use TLS and an
authenticating reverse proxy for every non-loopback deployment; see
[Self-hosting Sync](self-hosting-sync.md) for the complete boundary and
hardening requirements.

## Deployment Choices

- **Desktop:** build review-only unsigned staging bundles now; public installers
  require approved platform signing and notarization where required. See
  [Desktop Distribution](desktop-distribution.md).
- **Web Admin:** deploy the static read-only administration surface with its
  required security headers and a server-side snapshot proxy. Web Admin does
  not run SSH sessions. See [Web Admin Deployment](web-admin-deployment.md).
- **Sync Service:** self-host the single-process Rust service behind TLS with
  durable storage and distinct credentials. See
  [Self-hosting Sync](self-hosting-sync.md).

## Basic Verification

Run the focused Desktop and native checks before proposing a change:

```bash
npm run qa:desktop
npm run qa:rust
npm run qa:tauri
```

`qa:tauri` verifies that the native shell builds; it does not produce a signed
installer. Release candidates must also follow the gates in
[Release Preparation](release-preparation.md).
