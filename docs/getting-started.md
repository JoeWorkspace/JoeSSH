# Getting Started

**[Install JoeSSH free from Microsoft Store](https://apps.microsoft.com/detail/9nk5llmf8lhm)**

The Windows 10/11 x64 app is available now. You do not need a JoeSSH account,
Node.js, Rust, or a source checkout to use the Store app. JoeSSH remains a
Public Beta; SFTP uploads and downloads are limited to **25 MiB per operation**,
and local port forwards bind only to loopback addresses.

## Before You Connect

Have these details ready for a server you are authorized to access:

- Hostname or IP address, SSH port (usually `22`), and username.
- A password or private key to paste into the connection dialog, plus its
  passphrase if needed.
- The server's SHA-256 host-key fingerprint from a trusted source such as the
  server console or administrator. Do not trust a fingerprint solely because
  it appears in the connection prompt.

JoeSSH connects to an existing SSH server; it does not create or host one.
Saved profiles and workspace preferences stay on this device by default.
Keep passwords, private keys, and passphrases out of issues, logs, screenshots,
and shared configuration.

## Make Your First SSH Connection

### 1. Install And Open JoeSSH

Open the [Microsoft Store listing](https://apps.microsoft.com/detail/9nk5llmf8lhm),
install JoeSSH, then launch it from Windows. The screenshots in the README use
sample hosts; connect to your own authorized server to use live SSH.

### 2. Add Your Server And Credentials

Select **New**, enter a connection name and host, then fill in the SSH port and
username. You can add a group or tags to organize the profile. Select
**Create connection**, select the saved profile, and choose **Connect**.

Confirm the host, port, and username. Choose **Password** or **Private key**,
enter the password or paste the private key (and passphrase if required), then
select **Connect**. These are your server credentials, not a JoeSSH account.

### 3. Verify The Host Key And Start Working

For an unknown host, JoeSSH shows its SHA-256 host-key fingerprint before
authentication. Compare it with the fingerprint obtained through your trusted
channel. Select **Trust and connect** only when the values match.

A changed stored host key is blocked. Stop and investigate the server or key
rotation through a trusted channel; never clear or replace the stored key
merely to bypass the warning.

After the session connects, use the central terminal workspace for commands.
The **SFTP** panel browses and transfers files on the connected host; each
upload or download is limited to 25 MiB. **Port Forwarding** manages explicit
local tunnels bound to loopback, not ports exposed to your network.

## If You Cannot Connect

| What you see                  | What to check                                                                                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connection refused or timeout | Confirm the hostname/IP and SSH port, whether the server is running SSH, and whether you need a VPN or a server-side firewall rule. Do not disable security controls just to retry.                   |
| Authentication failed         | Confirm the server username and selected authentication method. For a private key, paste the complete key and supply its passphrase if it has one; the server must authorize the matching public key. |
| Unknown or changed host key   | Verify the fingerprint through the server console or administrator. A changed key needs investigation before you change the saved trust record.                                                       |
| Only sample data, no real SSH | Open the installed Windows app. The browser Desktop preview has no native SSH engine and cannot connect to a real server.                                                                             |
| SFTP transfer rejected        | Check the remote path and your server account permissions. Each upload or download must be no larger than 25 MiB.                                                                                     |

If the problem continues, [report an issue](https://github.com/JoeWorkspace/JoeSSH/issues/new/choose)
with your JoeSSH version, Windows version, steps, and the error text. Remove
credentials, private keys, server addresses you consider private, and sensitive
output before sharing. See [Support](../SUPPORT.md) for the community support scope.

## Build From Source (Developers)

Skip this section if you installed the Windows app from the Microsoft Store.
These prerequisites are for contributing or evaluating the source on another
platform.

### Prerequisites

Use the toolchain versions pinned by this repository:

- Node.js `22.22.2`
- npm `10.9.7`
- Rust `1.96.0`
- NASM available on `PATH` for the native Rust crypto build

Install the operating-system dependencies in the official
[Tauri 2 prerequisites guide](https://v2.tauri.app/start/prerequisites/). Follow
the section for your platform, including its compiler, WebView, and other
system-package requirements.

### Windows Source Build

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
available for those platforms yet.

Confirm the main tools before installing dependencies:

```bash
node --version
npm --version
rustc --version
nasm -v
```

### Get The Source

Clone the public repository and install its locked dependency graph:

```bash
git clone https://github.com/JoeWorkspace/JoeSSH.git
cd JoeSSH
npm ci
```

If the repository is already checked out, run only `npm ci` from its root.

### Run The Native Desktop App

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

## Sync Confidentiality

Public Beta Sync authenticates requests but stores submitted JSON payloads
without end-to-end encryption. Never place SSH private keys, passwords, bearer
tokens, terminal output, or other secrets in Sync payloads. Use TLS and an
authenticating reverse proxy for every non-loopback deployment; see
[Self-hosting Sync](self-hosting-sync.md) for the complete boundary and
hardening requirements.

## Deployment Choices

- **Windows Desktop:** install the free app from the
  [Microsoft Store](https://apps.microsoft.com/detail/9nk5llmf8lhm). GitHub
  beta.20 through beta.22 prereleases are source-only. Beta.23 through beta.25 are
  Store-candidate source revisions; their GitHub source records do not carry
  Windows installers. Unsigned CI bundles remain review-only staging artifacts.
  Source builds and distribution workflows are described in
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
