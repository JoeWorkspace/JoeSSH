# Microsoft Store Listing Draft

Status: pending listing reference for the distinct JoeSSH `0.1.0-beta.24`
Microsoft Store replacement candidate. The package identity, protected-main
source revision, MSIX hash, and Partner Center validation are not evidence until
the exact `1.1.24.0` package is generated and recorded. The existing Store
package is `1.1.22.0`; it does not prove certification or publication of this
new candidate. The local `1.1.23.0` qualification attempt is superseded and
must not be uploaded. Historical source records remain unchanged and
unavailable for new binary uploads.

This draft deliberately describes only the free Windows Community product that
exists today. It does not advertise Mobile SSH, hosted Sync, team mutations,
paid support, Founder/Pro benefits, or future encryption features.

The formal repository workflow verifies hosted candidates; it is not a build or
signing service. Both routes require `expected_sha256`. The legacy `https` route
also requires an exact transfer `artifact_url`; that URL and hash alone are not
authenticated build provenance. The reviewed `github-actions-artifact` MSIX
route requires the producer and generic verifier in the same protected source
commit. Its `producer_run_id`, attempt, and raw MSIX/evidence/attestation
artifact IDs are selectors rather than trust anchors: live GitHub metadata and
two offline-verified Sigstore bundles must bind the exact repository, workflow,
source SHA, run attempt, hosted runner, and MSIX bytes. The EXE URL must also be
immutable and versioned, and the same verified MSIX package must later be
submitted to Partner Center.
Local build scripts, local `--artifact` checks, handoff files, and
self-generated JSON cannot serve as formal listing or publication evidence.

The complete Store-language draft is maintained separately in the
[Microsoft Store localization manifest](microsoft-store-localization.md). It
covers 80 discoverability locales while preserving the distinction between
Store listing language and the 15 shipped application UI locales. It is draft
content only and must not be imported while no candidate has completed Partner
Center certification. Native-review handoff work is tracked in the generated
`native-review-handoff.csv`; it is not approval evidence until a human reviewer
fills and verifies its evidence columns.

## Submission Positioning

- Product name: `JoeSSH`
- Store listing title: `JoeSSH` for every locale; use descriptions and localized
  keywords for positioning.
- Release maturity: Windows x64 Store replacement candidate, version
  `0.1.0-beta.24` / MSIX `1.1.24.0`
- Offer: free Community desktop app; no ads or in-app purchases
- Primary category: Developer tools
- Supported device family: Windows desktop
- Supported release architecture: x64
- Supported operating systems: Windows 10 and Windows 11
- Pricing: Free
- Package strategy: use the Store-re-signed, Store-hosted, Store-updated MSIX
  route. Qualify the exact beta.24 bytes with the repaired offline WACK
  toolchain and clean-machine lifecycle checks before Partner Center upload.
- Initial discoverability recommendation: direct-link-only until the signed
  candidate, support route, privacy route, and first external test cohort have
  passed; changing to Store-search discoverability is a separate go/no-go
  decision
- Markets: explicitly review and select supported markets instead of accepting
  future markets silently
- Store listing languages: the 80-locale discoverability manifest may be prepared
  independently of shipped UI packs. Each locale still requires native review,
  at least one reviewed screenshot, and the submission readiness gate. Never
  present a discoverability-only listing as a fully translated installed UI.
- Installed product license: MIT, including the build-specific JoeSSH license
  and third-party notices available from Settings

## en-US Listing

### Short description

Public Beta: local-first SSH, terminal, SFTP, and port forwarding for Windows.

### Description

Requires a reachable SSH server you are authorized to use and a password or
pasted private key. No JoeSSH account is required.

JoeSSH Public Beta is a focused Windows workbench for connecting to servers
without turning your connection workflow into a hosted service. Use one
workspace to organize SSH connections, verify host keys, work in interactive
terminal sessions, transfer files with SFTP, and manage local port forwards.
Saved connection profiles and workspace preferences stay on this device by
default.

Built for careful operations:

- Review a server host key before trusting it.
- Organize multiple terminal sessions with workspace tabs.
- Browse, upload, and download files through SFTP.
- Start and stop explicit loopback-only local port forwards.
- Use light or dark appearance.
- Read the exact JoeSSH and third-party notices bundled with the installed
  build.

This Public Beta limits each SFTP upload or download to 25 MiB. It is intended
for evaluation and careful day-to-day use while release evidence and external
compatibility coverage continue to grow.

JoeSSH Community is free and available from its public source repository under
the MIT License. Telemetry and error reporting are disabled by default. JoeSSH
does not require an account and does not currently provide a hosted service.

You need permission to access every server you connect to. Never use JoeSSH to
access systems, accounts, or networks without authorization.

### Product features

Enter these as separate Store feature rows without adding bullet characters:

1. SSH host-key review and trusted-host management
2. Interactive terminal workspaces
3. SFTP browsing and transfers up to 25 MiB per operation
4. Loopback-only local port-forward lifecycle controls
5. Local-first connection organization
6. Light and dark themes
7. Build-specific open-source license notices

### Keywords

Use no more than seven entries:

1. SSH
2. SFTP
3. terminal
4. port forwarding
5. developer tools
6. server administration
7. local-first

### Additional system requirements

- An x64 device running a supported Windows 10 or Windows 11 release
- Network access to an SSH server you are authorized to use
- Server credentials and a supported SSH authentication method

## zh-CN Listing

### 简短说明

Public Beta：面向 Windows 的本地优先 SSH、终端、SFTP 与端口转发工具。

### 说明

需要一台你已获授权访问且网络可达的 SSH 服务器，以及密码或粘贴输入的私钥。不需要
JoeSSH 账号。

JoeSSH Public Beta 是一款专注的 Windows 服务器连接工作台，不要求把连接工作流托管到
云端服务。你可以在同一个工作区中整理 SSH 连接、核验主机密钥、使用交互式终端、
通过 SFTP 传输文件，并管理本地端口转发。保存的连接配置和工作区偏好默认保留在本机。

面向谨慎的日常运维：

- 在信任服务器前核对主机密钥。
- 使用工作区标签整理多个终端会话。
- 通过 SFTP 浏览、上传和下载文件。
- 明确启动和停止仅绑定本机回环地址的端口转发。
- 使用亮色或暗色主题。
- 在设置中阅读当前安装版本随附的 JoeSSH 与第三方许可证声明。

当前 Public Beta 对每次 SFTP 上传或下载设置 25 MiB 上限。它适合评估和谨慎的日常
使用，发布证据与外部兼容性覆盖仍在持续完善。

JoeSSH Community 免费提供；源码仓库已公开，并按 MIT 许可证提供。遥测和错误
上报默认关闭。JoeSSH 不要求账号，当前也不提供托管服务。

你必须获得所连接服务器的合法授权。请勿使用 JoeSSH 访问任何未经授权的系统、账号
或网络。

### 产品功能

在 Partner Center 中逐项填写，不要自行添加项目符号：

1. SSH 主机密钥核验与可信主机管理
2. 交互式终端工作区
3. 单次不超过 25 MiB 的 SFTP 浏览与传输
4. 仅限回环地址的本地端口转发生命周期控制
5. 本地优先的连接整理
6. 亮色与暗色主题
7. 随构建提供的开源许可证声明

### 关键词

最多使用七项：

1. SSH
2. SFTP
3. 终端
4. 端口转发
5. 开发者工具
6. 服务器管理
7. 本地优先

### 其他系统要求

- 运行受支持 Windows 10 或 Windows 11 版本的 x64 设备
- 能够访问你已获授权使用的 SSH 服务器
- 服务器凭据和受支持的 SSH 身份验证方式

## Store Assets

Partner Center currently requires at least one screenshot and recommends four
or more, with a maximum of ten. The current MSI/EXE submission checklist also
requires 1:1 box art and recommends 2:3 poster art. Reconfirm the dimensions and
file limits shown by Partner Center at submission time.

Prepare four real-product screenshots for each submitted listing locale:
four en-US and four zh-CN screenshots, eight files total. Each locale set must
cover both light and dark appearance. Use an isolated certification fixture and
synthetic sample content; no production hostnames, usernames, addresses, paths,
command history, keys, or tokens may appear.

1. Connection workspace with a live terminal connected to the isolated fixture.
2. Host-key review state showing the fixture's real, pre-reviewed public
   fingerprint.
3. SFTP browser showing a synthetic directory and transfer state.
4. Port-forward panel showing a synthetic, stopped or sample-only rule.

The existing visual-regression snapshots are QA evidence and useful composition
references, but Store uploads must be captured from the exact signed candidate
commit and reviewed at 100% zoom. Do not upload ImageGen concept boards as
product screenshots.

Before upload:

- verify every screenshot comes from the exact candidate version;
- verify the UI marks synthetic/demo state accurately;
- inspect at 100%, 125%, 150%, 175%, and 200% Windows scaling;
- remove cursor artifacts, clipped text, debug panels, and development URLs;
- ensure foreground/background contrast remains readable after Store
  compression;
- record each asset SHA-256 next to the candidate evidence.

Use the fail-closed [Store asset preparation workflow](windows-store-assets.md).
The tracked `docs/assets/microsoft-store` bundle contains reproducible 1:1 and
2:3 brand art plus reference metadata, but its manifest is deliberately
`provisional-not-uploadable`. Only a private bundle containing all eight
exact-candidate captures, `candidate-binding.json`, and a verified checksum
manifest can advance to final human review.

## Policy, License, And Contact Fields

- Personal information declaration: select `Yes`. Microsoft Store policy
  treats Win32 products as inherently able to access personal information, so
  a privacy policy is mandatory even when production telemetry is disabled.
- Privacy URL: blocked until a real public HTTPS page is reachable while logged
  out and matches the shipped data flow.
- Support contact: Partner Center may accept a URL or email for MSI/EXE support
  information, but JoeSSH applies the stricter internal gate of a monitored
  public HTTPS route that works while logged out.
- Prepare the two static pages from
  [`store-public-pages`](store-public-pages/README.md) outside the repository so
  no personal identity is committed accidentally. After publication, run the
  complete [Store policy preflight](release-preparation.md) with the local
  canonical `--partner-identity` file, both public URLs, and
  `--confirm-public-links`; setting only URL variables is insufficient. The
  preflight rejects placeholders, authentication redirects, non-public DNS,
  non-HTML responses, and content that does not match the page role.
- Applicable license terms: paste the complete, exact repository `LICENSE`
  contents into the required text field. A URL alone is not accepted by the
  JoeSSH release gate.
- Copyright/trademark: use only the truthful owner/publisher information
  accepted by Partner Center; do not claim a registered trademark.
- Developed by: use the truthful verified publisher display name.
- What's new: use only the reviewed beta.24 maintenance text after it is bound
  to the exact package; do not describe the superseded beta.23 attempt as
  published.
- Accessibility declaration: leave the voluntary declaration unchecked until
  the exact native candidate passes the complete Microsoft accessibility tool
  and assistive-technology matrix. Keyboard coverage alone is not sufficient.

The account decision for this release is `Individual`: the operator is one
person with no company, and this Community release is free, open source, and
noncommercial. After Partner Center identity verification, copy the displayed
personal `publisherDisplayName` exactly. Do not use the base Tauri value
`JoeSSH Project`, the product name, a GitHub username, or an invented studio
name as the legal Store publisher. The separate package `publisher` value must
be copied from Product identity and begins with `CN=`; it must not be invented
from the personal name.

This decision applies only to the current noncommercial release. Partner Center
does not convert an Individual account to Company in place. Before any future
freelance, sole-trader, company, paid-benefit, or other commercial release,
recheck the applicable account, business-verification, legal, and tax path.
Keep funding, checkout, paid benefits, and paid support disconnected from this
candidate.

## Certification Notes Draft

Provide these notes only after they match the uploaded candidate:

- JoeSSH is a Win32 desktop SSH client. Network connections and port forwards
  occur only after the user configures and starts them.
- The Community build has no ads, checkout, subscription, in-app purchase,
  hosted account, or production telemetry endpoint.
- The preferred MSIX route uses the exact Partner Center package identity,
  declares the full-trust capability truthfully, records
  `pending-microsoft-store-signing` before certification, and submits the same
  SHA-256 package that passed hosted verification.
- The NSIS route uses the case-sensitive silent-install argument `/S` and an
  offline WebView2 installer. Every installed PE must be signed by the approved
  public-CA certificate; include this paragraph only when the documented MSIX
  feasibility spike failed and NSIS is the selected fallback.
- Before submission, provision a reachable, isolated, non-production SSH
  fixture and one-time reviewer credentials that remain valid throughout
  certification. Record the fixture availability window and provide exact
  steps for host-key review, password or private-key authentication, PTY, SFTP
  upload/download, and loopback port forwarding in the secure certification
  notes. Never include production credentials.
- Third-party license notices are available in Settings and are hash-bound to
  the submitted candidate evidence.

## Final Listing Gate

The listing is still `NO-GO` until all of the following are true:

- the JoeSSH name is reserved in the selected Store product type;
- Individual onboarding and identity verification are complete for the current
  free noncommercial release, and the publisher is the exact verified personal
  display name rather than `JoeSSH Project` or another alias;
- the truthful publisher identity is verified and matches the package route;
- the repository and exact candidate source are publicly reachable before the
  listing calls JoeSSH open source;
- real privacy and support HTTPS links pass a logged-out check;
- the signed EXE or validated MSIX passes the candidate contract;
- the exact candidate EXE or MSIX comes from the reviewed direct HTTPS
  `artifact_url` or a same-commit `github-actions-artifact` producer run whose
  live metadata and offline attestations pass the generic verifier, and its bytes
  match `expected_sha256`;
- the EXE route has an immutable, versioned, direct HTTPS installer URL whose
  bytes and SHA-256 match the candidate evidence;
- the EXE route includes a reviewed 40–1000 character
  `msix_fallback_justification` that identifies the real MSIX compatibility
  blocker; MSIX remains the workflow default and carries no certificate
  identity fields;
- the MSIX route submits the same SHA-256 package to Partner Center and does not
  treat its verification transfer URL as long-term distribution evidence;
- the exact candidate, source provenance receipt, and hosted evidence are
  independently rechecked in a clean VM; authenticated source-build provenance
  is not described as installation, WACK, Store signing, certification, or
  publication evidence;
- Pricing, Markets, and Discoverability are explicitly selected and recorded;
- four screenshots per submitted locale and required Store art are complete;
- the isolated SSH certification fixture, temporary credentials, availability
  window, and PTY/SFTP/forward test steps are verified from outside the
  maintainer's network;
- the age-rating, properties, availability, license, and certification-note
  fields are reviewed in Partner Center;
- the voluntary accessibility declaration remains unchecked unless the exact
  native candidate has complete Inspect/Accessibility Insights, Narrator,
  Magnifier, On-Screen Keyboard, High Contrast, and High DPI evidence;
- `npm run qa:windows-store-surfaces:runtime` passes against the exact Store
  frontend, including the built-product Playwright narrow-window, light/dark,
  shortcut, command-palette, hidden-surface, and overflow checks;
  the Store overlay is bound to the `microsoft-store` build profile and the
  candidate visibly omits Business/Team, recording, encrypted-snippet Sync,
  Web Admin, and Mobile preview surfaces;
- every required JoeSSH Windows App Certification Kit test plus Partner Center
  package validation, silent install/uninstall, ARP, and single-product-entry
  evidence is attached to the exact candidate; optional WACK findings are
  recorded and reviewed separately rather than hidden or treated as required;
- no future, hosted, paid, or unavailable capability appears in the listing.

Current Microsoft references:

- <https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/create-app-submission>
- <https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/add-and-edit-store-listing-info>
- <https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/screenshots-and-images>
- <https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements>
- <https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/support-info>
- <https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/product-declarations>
- <https://learn.microsoft.com/en-us/windows/apps/distribute-through-store/how-to-distribute-your-win32-app-through-microsoft-store>
- <https://learn.microsoft.com/en-us/windows/apps/publish/store-policies>
- <https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/open-a-developer-account>
- <https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options>
- <https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-distribution-path>
