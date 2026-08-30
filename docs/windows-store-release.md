# Windows / Microsoft Store 候选发布

## 构建级法律证据

任何 Store 构建之前都必须运行
`npm run release:desktop:legal-resource`。该命令会生成并验证两份 npm 与
两份脱敏 Cargo CycloneDX SBOM，以及包含 JoeSSH 自身完整 MIT `LICENSE`
的构建级许可证包。包含机器本地路径的原始 Cargo metadata
只保留在 `reports/internal/release-inputs/`，不得作为 Store 或 GitHub
Release 上传物。

Tauri 会把
`reports/release/third-party-licenses/THIRD-PARTY-NOTICES.txt` 映射为安装后
的 `legal/THIRD-PARTY-NOTICES.txt`。候选预检会先验证许可证包以及这条精确
资源映射，再复制二进制或 notices 证据。

`candidate.json` 必须记录 notices、许可证 manifest、许可证 checksum
manifest 与 `SBOM-SHA256SUMS.txt` 的路径和 SHA-256，并以按路径排序且恰好
四项的 `legalNotices.sboms` 绑定两份 npm 和两份 Cargo 公共 SBOM。
`attestations.protectedEnvironment` 必须重复绑定许可证与 SBOM checksum
manifest 的 SHA-256，`gates.publicSbomsBound` 必须为 `true`。这些值必须与
已审核源码、hosted workflow evidence 中的复核值和候选副本一致；候选
`SHA256SUMS.txt` 同时覆盖安装包、candidate JSON 与
`THIRD-PARTY-NOTICES.txt`。缺失、改名、陈旧、多余或 hash 不一致都必须阻断
发布。

## 已确认的工具边界

JoeSSH 锁定的 Tauri CLI 2.11.4 在 Windows 只提供 `nsis` 和 `msi`
bundle target。**Tauri 2 不原生生成 MSIX**，`targets: "all"` 也不会生成
MSIX。因此本项目把两条路径完全隔离：

1. `EXE`：使用 Tauri 原生 NSIS，面向 Partner Center 的 “EXE or MSI
   app” 路径。
2. `MSIX`：在 Partner Center 保留应用身份之后，由受保护源码 producer 编译
   Tauri executable，再用 runner-discovered 同一 Windows SDK 的 MakeAppx 单独
   打包和验证，并把 SDK 版本与工具 hash 写入 predicate。它不是 Tauri bundle，
   也不能标成 Tauri 原生 MSIX 产物。

官方依据：

- [Tauri Microsoft Store 指南](https://v2.tauri.app/distribute/microsoft-store/)
- [Microsoft 的 EXE/MSI 包要求](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements)
- [Microsoft 的 EXE/MSI 上传要求](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/upload-app-packages)
- [Microsoft MSIX Packaging Tool](https://learn.microsoft.com/en-us/windows/msix/packaging-tool/create-app-package)
- [MSIX Packaging Tool 断网环境](https://learn.microsoft.com/en-us/windows/msix/packaging-tool/disconnected-environment)
- [Microsoft Store MSIX 包与版本要求](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)
- [Partner Center 应用身份](https://learn.microsoft.com/en-us/windows/apps/publish/view-app-identity-details)
- [Microsoft Store 的 Windows 签名路径](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
- [Microsoft 的分发路径选择](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-distribution-path)
- [Partner Center 开发者账号类型](https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/open-a-developer-account)

## 正式主路径：受保护源码构建 MSIX

MSIX 可行性阶段已经结束。正式候选必须来自 protected `main` 的精确 reviewed
SHA：14 项 required CI 全绿后，经 `windows-release-stage-b` 人工批准运行
`.github/workflows/windows-store-build.yml`。该 workflow 锁定 Node、npm、Rust 和
Actions，从 runner 发现同一 Windows SDK/compiler/MakeAppx，并记录 SDK 版本与
对应工具 hash；随后构建 Store surface 和 Desktop executable，生成并 roundtrip 验证
unsigned MSIX，上传 raw/transport/evidence，并在重新核对同一 run 字节与 predicate
后生成 SLSA 和 JoeSSH build-bindings 两份 Sigstore attestation。它不读取签名
secret，也不声称 WACK、Store 签名、认证或发布已经完成。

beta.24 必须使用新的 `1.1.24.0` source build。已被替代的 `1.1.23.0` 包、
producer evidence 和 native qualification 记录保持不可变，不得重新包装或提交。
只有新的、可复现且有证据的 MSIX 兼容阻塞才允许另开变更评估 NSIS fallback。

商业发布即使只有一名开发者，也不等于应选 Individual。Individual 只用于真实
非商业个人/业余发布；自由职业者、个体经营者或其他商业发布应走 Company
onboarding，并准备真实登记文件、D-U-N-S 或 Microsoft 接受的替代商业文件，
以及工作/域名身份验证。Individual 账号不能原地转换为 Company。

## 回退路径：签名 NSIS EXE

`apps/desktop/src-tauri/tauri.microsoftstore.conf.json` 是独立的 Store
配置，只生成 NSIS，并把 WebView2 切换为 `offlineInstaller`。默认的在线
bootstrapper 不满足 Store 对 standalone/offline installer 的要求。

基础 `tauri.conf.json` 中的 `JoeSSH Project` 仅是 Community 构建的非正式
项目元数据，**不能作为 Store 候选的发布者身份**。正式 workflow 不负责构建
或签名；`policy` 只从受保护的 `windows-release-stage-b` environment 通过
只读 API 核验 `ATLASTERM_WINDOWS_LEGAL_PUBLISHER` 与公开证书身份，
`verify` 再用这些公开值校验已经托管的候选字节。任何外部签名/构建系统都必须
自行证明生成字节来自 reviewed SHA，workflow 不会为缺失 provenance 背书。

EXE 路径必须同时满足：

- 安装器及安装后的所有 PE 文件都有有效 Authenticode 签名，证书链可由
  Windows 信任并带可信时间戳；
- 证书 subject 必须只有一个 `CN`，且该值、NSIS 写入的 ARP `Publisher`、
  公开政策中的 Store seller 与受保护的法定发布者必须逐字符一致；
- 安装器支持无界面的静默安装；Tauri NSIS 使用区分大小写的 `/S`；
- 下载地址是带版本的 HTTPS 直链，提交后该 URL 对应的二进制不得替换；
- 发布者自己负责托管和更新行为。Microsoft Store **不会替 EXE/MSI
  重签名**，也不会把它变成 MSIX。

`.github/workflows/windows-store-candidate.yml` 是 hosted candidate 验证
workflow，不负责构建或签名。`candidate_source` 只能选择 `github-actions-artifact`
或 `https`，两条路径都必须提供 `expected_sha256`。HTTPS 模式要求可直接下载的
`artifact_url`；EXE 直发地址还必须不可变且带版本，但 URL 加 hash 本身不构成
authenticated provenance。正式 MSIX 使用 artifact 模式：source producer 与通用
verifier 必须在同一个 protected-main commit，`artifact_source_sha == reviewed_sha`
且等于 dispatch `github.sha`；`producer_run_id`、attempt 和 raw MSIX/evidence/
attestations 三项 artifact ID 只负责定位，真实性由 live metadata、精确下载字节和
两份离线 Sigstore bundle 共同证明。后续必须把同一 SHA-256 的包提交 Partner
Center。workflow 中没有 build/sign job、self-hosted runner、OIDC、签名 secret、
managed signer 或用户提供的本地 handoff。
仓库和 Actions 中仍然**禁止保存、base64 编码或临时导入 PFX**，但这项禁令
不能被误读为仓库已经提供了替代签名服务；当前只验证外部提供的已签名 EXE。

`npm run release:windows-store:build` 与本地 `--artifact` 预检仍保留供开发者
在隔离 Windows VM 中诊断。它们不在 privileged workflow 中，产生的本地
JSON、安装包或 checksum **不能作为正式发布证据**，也不能绕过选定 source、
SHA-256、来源 provenance 与独立验证要求。

本地诊断预检会真实执行 `/S`，因此只能在一次性 Windows VM 或 CI runner 上
运行。它先拒绝已有 JoeSSH 安装，再校验安装器签名、静默安装结果以及安装
目录内每个 `.exe/.dll/.sys/.ocx/.cpl/.scr` 的签名；最后用已验签的
uninstaller 执行 `/S` 静默卸载，并要求产品注册和安装目录都被清除：

```powershell
node scripts/prepare-windows-store-candidate.mjs `
  --format exe `
  --artifact apps/desktop/src-tauri/target/release/bundle/nsis/JoeSSH_<version>_x64-setup.exe `
  --expected-sha256 <64位SHA-256> `
  --reviewed-sha <完整Git提交> `
  --artifact-source-sha <生成该二进制的完整Git提交> `
  --architecture x64 `
  --allow-silent-install
```

EXE 预检还要求
`JOESSH_WINDOWS_RELEASE_ENVIRONMENT=windows-release-stage-b`、
`ATLASTERM_WINDOWS_LEGAL_PUBLISHER`、`ATLASTERM_WINDOWS_CERTIFICATE_SUBJECT` 和
`ATLASTERM_WINDOWS_CERTIFICATE_THUMBPRINT`。正式 hosted workflow 由
`policy` 的公开 output 注入这些值；本地诊断只能由操作员显式设置相同变量，
用于在隔离 VM 中模拟输入，不能作为正式证据。subject 与 40 位 thumbprint
必须是预先审批的证书身份；安装器、`JoeSSH.exe`、uninstaller 及安装目录内
每一个 PE 都必须与二者精确匹配。安装后的 ARP `Publisher` 必须等于项目法定
publisher，`DisplayVersion` 必须等于当前项目版本。

候选文件只读取一次，捕获的字节会写入 runner 私有临时目录；后续
Authenticode、SignTool、MakeAppx 和安装器执行都只针对这个私有 snapshot，
不再使用原下载或构建路径。这避免了“验签一个路径、执行时路径内容已被替换”
的时间竞争。

`--architecture` 不能使用无法从本机 PE 证明的 `neutral`。预检读取安装后的
`JoeSSH.exe` PE machine，并要求它与 `x86`、`x64` 或 `arm64` 输入精确
一致。即使任一 payload 校验失败，脚本也会尽力执行已经验签且 signer
匹配的 uninstaller；若 payload 与清理同时失败，两项原始错误都会保留。

托管后改用 `--download-url`，脚本会禁用 HTTP 重定向、重新下载并绑定实际
SHA-256。URL 路径必须以独立目录段包含版本，并以候选文件的精确名称结尾；
credentials、query 和 fragment 全部拒绝，避免令牌进入候选证据。预检完成后
会再次下载同一 URL，并在每次下载、私有 snapshot 和最终证据副本上重新验证
SHA-256。

“路径带版本”本身不证明对象不可变。未提供明确的对象锁/留存人工证明时，
`candidate.json` 会把 URL immutability 保持为 `unverified`。可选的
`--hosted-retention-attestation` 只接受绑定精确 URL、SHA-256、对象 version
ID、retention mode、未来留存期限和核验人的受控 JSON；它仍是人工 attestation，
不是加密构建 provenance。

## 正式 MSIX 身份与 source producer

先在 Partner Center 创建 “MSIX or PWA app” 并保留名称。随后从真实的
Product identity 页面逐字复制至少以下字段，保存到不提交仓库的 JSON：

```json
{
  "schemaVersion": 1,
  "source": "partner-center",
  "productId": "CHANGE-ME",
  "packageIdentityName": "CHANGE-ME",
  "publisher": "CHANGE-ME",
  "publisherDisplayName": "CHANGE-ME",
  "publisherId": "CHANGE-ME",
  "packageFamilyName": "CHANGE-ME",
  "reservedAt": "CHANGE-ME"
}
```

本次 Community 发布已明确为个人、无公司、免费开源且非商业，因此使用
Individual developer account。`publisherDisplayName` 必须是 Partner Center
完成个人身份验证后显示的**精确个人姓名**；不要填写 `JoeSSH`、
`JoeSSH Project`、`JoeSSH Community`、GitHub 用户名或临时工作室名。
`publisher` 是 Product identity 页面另一个独立的 `CN=` package identity
字段，不要用个人姓名自行拼接。不要把真实姓名、身份证件或验证材料提交到仓库、
Issue、PR 或聊天中。如果发布意图以后变成商业活动，应重新核对账号资格；
Individual account 不能原地转换为 Company。

使用仓库提供的两阶段 writer，避免把个人姓名放进命令行历史。第一步只生成
位于 gitignored `reports/` 目录的占位模板：

```powershell
node scripts/write-partner-center-identity.mjs --write-template
```

在本机编辑
`reports/handoff/windows-store/partner-center-identity.input.json`：
`productId`、`packageIdentityName`、`publisher`、`publisherDisplayName`、
`publisherId` 和 `packageFamilyName` 从 Product identity 页面逐字复制，
`reservedAt` 记录名称保留完成时刻并使用规范 UTC ISO 时间。然后生成可直接传给
预检的规范 JSON：

```powershell
node scripts/write-partner-center-identity.mjs `
  --input reports/handoff/windows-store/partner-center-identity.input.json
```

默认输出为
`reports/handoff/windows-store/partner-center-identity.json`。writer 只接受预检
schema 中的九个字段，拒绝额外 token、证件或签名材料，拒绝静默裁剪字段、
仓库内非 gitignored 输出和覆盖已有文件，并且不会把任何身份值打印到终端。
需要重新生成时，先把旧的本地文件移到仓库外留档，再执行；不要删除或覆盖已经
用于候选证据的输入。

所有 `CHANGE-ME`、example、placeholder 等值都会被拒绝。预检只接受
`.msix`，调用 Windows SDK 的 `MakeAppx.exe unpack`（不使用 `/nv`）做
语义验证，并要求 `AppxManifest.xml` 的 `Identity.Name`、
`Identity.Publisher` 和 `PublisherDisplayName` 与 Partner Center 完全
相同；其中 `PublisherDisplayName` 还必须逐字符等于受保护的
`ATLASTERM_WINDOWS_LEGAL_PUBLISHER`，从而把 Partner Center seller 与本次
候选的法定发布者绑定。MSIX 版本必须是纯数字四段式；当前 npm 的
prerelease 字符串不能
直接写入 manifest。作为 Tauri Win32 桌面应用，manifest 还必须声明
`Windows.Desktop`、`packagedClassicApp`、`mediumIL` 和受限能力
`runFullTrust`；该能力的用途说明及审批仍由 Partner Center 处理。

manifest 使用 strict、namespace-aware XML parser 解析；要求唯一的 desktop
`Application` 节点同时包含 `Executable`、`packagedClassicApp` 和
`mediumIL`，不能把这些标记拆到多个 decoy 节点。解包树拒绝符号链接、硬链接、
越界路径和异常规模；`Application.Executable` 必须是包内安全相对路径，其
真实 PE machine 必须与 `Identity.ProcessorArchitecture` 一致。
`packageFamilyName` 会通过 Windows package identity API 拆出 package name
和 13 位 `publisherId`，再与 Partner Center 输入交叉校验。

版本映射是确定性且保序的：项目版本映射为
`(major + 1).minor.(patch * 100 + channel).0`，其中 `beta.n` 仅允许
`n=1..98` 并使用 `channel=n`，正式版使用 `channel=99`。因此
`0.1.0-beta.10` 只能对应 `1.1.10.0`，`0.1.0` 对应 `1.1.99.0`，
`0.1.1-beta.1` 对应 `1.1.101.0`。这同时保证 Microsoft Store 要求的首段
非零、第四段为零，以及 beta、同 patch 正式版、下一 patch beta 的严格递增；
项目 `major` 最大为 `65534`、`minor` 最大为 `65535`、`patch` 最大为 `654`，
从而保证每个可接受的 beta 都存在同 patch 的正式版映射；越界输入会被拒绝。
脚本还会拒绝 manifest 中的 XML comment、DTD/entity 和 CDATA，避免用注释或
实体伪造 Identity、PublisherDisplayName 或 full-trust 标记。

正式 producer 是 `.github/workflows/windows-store-build.yml`。它只接受 protected
`main` 上与 `github.sha` 相同的完整 `reviewed_sha`、canonical public
`partner_identity_base64` 和 1–30 天 retention；`build` job 必须经过现有
`windows-release-stage-b` environment 人工批准。运行顺序固定为：

1. checkout 精确 SHA，锁定 Node 22.22.2、npm 10.9.7、Rust 1.96.0 和
   Actions，使用 `npm ci --ignore-scripts`；从 runner 发现同一 Windows SDK
   的 compiler 与 MakeAppx，并记录实际 SDK 版本和两个工具的 hash；
2. 通过 GitHub API 复核同一 SHA 的 14 项 required CI 与实际 environment
   approval，生成法律资源、四份 SBOM 和 Store frontend；
3. 从源码编译 x64 `atlasterm-desktop-shell.exe`，生成带 15 个 canonical UI
   locale、Partner identity 和 `runFullTrust` 的 AppxManifest；
4. 用 MakeAppx pack/unpack，证明 manifest、payload、legal notices、icons 和
   executable 全部 roundtrip 一致，并把 source binding、工具版本和输出 SHA-256
   写入 predicate；
5. 分别上传 raw unsigned MSIX、download-safe transport 和 build/legal evidence；
6. `attest` job 按 artifact ID 下载同一 run 的 raw bytes/evidence，先复核
   filename、size、SHA-256、predicate SHA-256、source SHA 和 run identity，再申请
   OIDC 生成默认 SLSA 与项目 build-bindings 两份 Sigstore bundle。

producer 生成 bundle 只完成签名材料的创建，不等于独立验证。通用 fail-closed
verifier 必须在 source build 之前与候选源码一起审核、合并，不能在构建后用新的
源码提交写死刚产生的 tuple。合并后在同一个 source commit 上运行 producer，再把
精确 run/attempt 和三项 artifact ID 作为候选 workflow 的受控运行时输入；verifier
实时读取 artifact metadata，复算候选、predicate 与 bundle hash，并逐项验证 subject
digest、repository、workflow、ref、SHA、run/attempt、证书身份、transparency log、
trusted root 和项目自定义 predicate，最后生成绑定完整 tuple 的不可变 workflow
receipt。在该 receipt 通过前，两份 bundle 都只能记为 pending evidence；不得据此
提交候选。

source binding 必须包含原生 `build.rs` 和 `windows-app-manifest.xml`。build 前后
任一绑定文件发生变化都失败。producer 直接生成完整 15-locale manifest，不再依赖
Packaging Tool 的 `en-us` 默认值或事后 finalizer。80 个 Store listing 仍只是
discoverability metadata，不能误报成 80 个完整 UI 语言。

`release:windows-store:msix-sandbox`、MSIX Packaging Tool 离线 bundle 和
`release:windows-store:msix-finalize` 只保留为历史/隔离诊断工具。它们生成的本地
包、JSON 或 checksum 不是 beta.24 正式 source provenance，也不能替代上述 workflow。
不得把 NSIS 改后缀、重打 beta.23 包或把未认证 MSIX 描述为 “Store 已签名”。

独立 WACK、upgrade/clean-install lifecycle、guest cleanup、host evidence rehash 和
UI handoff 使用受控的
[native verification bundle contract](windows-store-native-verification.md)。每个新
job 必须绑定 exact MSIX SHA256、merged source commit、七组件 toolchain manifest
和完整原始 WACK XML；不得补写或复用旧 job。

`.github/workflows/windows-store-candidate.yml` dispatch 以
`partner_identity_base64` 接收这份公开 Partner Center identity JSON；它不是
secret，也绝不能包含令牌或签名材料。该 candidate workflow 的 `policy` 只做
输入语法和实时策略检查，`verify` 在 runner 临时目录解码并在结束时删除。
`verify` 不挂载 environment、没有 `id-token: write`，也不读取任何
`${{ secrets.* }}`。脚本能证明 manifest 与输入完全一致，但不能离线证明
这些值确实由 Microsoft 分配。因此候选证据会明确记录该限制，名称保留或
本地匹配都不能当成商店认证证据。

candidate workflow 的 HTTPS URL 加 SHA-256 输入只能证明下载字节与操作员声明
一致，不能验证私有 Actions artifact 的来源，也不能构成 authenticated provenance。
beta.24 必须选择同一 source commit 的 GitHub Actions artifact 路径，并让已合并的
通用 verifier 在候选运行中现场验证该次 source build 的精确 tuple；旧 beta.23 tuple、
后续源码提交硬编码的 tuple 或只校验 URL 与 SHA-256 的运行都不能复用为 beta.24
来源证据。下面的本地命令只复核 workflow 已下载并生成 receipt 的 artifact 字节；
它不是 producer，也不能代替 workflow 对 live metadata 和两份 bundle 的验证：

```powershell
node scripts/prepare-windows-store-candidate.mjs `
  --format msix `
  --artifact C:\staging\JoeSSH_1.1.24.0_x64_<sha12>_<run>_<attempt>.msix `
  --github-actions-provenance C:\staging\github-actions-source-provenance.json `
  --expected-sha256 <64位SHA-256> `
  --reviewed-sha <完整Git提交> `
  --artifact-source-sha <生成该二进制的完整Git提交> `
  --partner-identity C:\secure\partner-center-msix-identity.json
```

Store-only MSIX 可以在认证后由 Microsoft Store 重签。预检若看到已有签名
会验证它；未签名时只记录 `pending-microsoft-store-signing`，绝不会生成
“已签名”证据。若同一 MSIX 还要网站直发或 sideload，则必须另行使用受信
证书签名，并让证书 subject 与 manifest Publisher 匹配。

## 手动工作流

`.github/workflows/windows-store-candidate.yml` 是 fail-closed 的手动候选
验证工作流；本文档**不声明远端仓库目前已经完成这些保护**。两种 source 都要求
完整 `artifact_source_sha` 与 `expected_sha256`。HTTPS 模式要求非空
`artifact_url` 并严格留空五项 Actions selector；artifact 模式要求 URL 为空、格式
为 MSIX，并提供 `producer_run_id`、`producer_run_attempt`、raw MSIX
`candidate_artifact_id`、`evidence_artifact_id` 和 `attestations_artifact_id`。
不存在“URL 为空就本地构建”的分支。每次运行时，`policy` 会在受保护 environment
批准之后用只读 fine-grained token 实时读取 GitHub API，并要求：

- `candidate_format` 默认且首选 `msix`；选择 EXE 时必须提供 40–1000 字符、
  去首尾空格、无控制字符且非占位的 `msix_fallback_justification`，选择
  MSIX 时该输入必须严格为空；
- dispatch 必须来自受保护 `main`，`reviewed_sha` 必须与 `github.sha` 完全相同；
  artifact 模式还要求 `artifact_source_sha == reviewed_sha`，五项 selector 都是
  无前导零的正十进制整数，三个 artifact ID 互不相同；
- `windows-release-stage-b` 恰好有一个 required reviewer（仓库所有者），关闭
  `prevent self-review` 以允许单维护者批准自己触发的部署，关闭 admin bypass，
  且只允许 protected branches；该人工暂停点不构成独立审核；
- `main` 的证据必须来自可读取的直接 classic
  `/repos/<owner>/<repo>/branches/main/protection` endpoint，并开启 strict
  required checks、PR 要求、线性历史、讨论解决和 admin enforcement；当前
  solo-maintainer 模式要求审批数严格为 `0` 且关闭 last-push approval，并且无
  reviewer bypass、force-push 或 deletion；ruleset
  只能补充，不能替代这套直接保护；
- API 403/404、字段缺失或任一策略不符都直接阻断。

远端必须配置 `ATLASTERM_RELEASE_POLICY_READ_TOKEN`；它只能拥有本仓库所需
的只读 Environments 与 Administration/API 读取权限，不能写仓库、创建
deployment 或调用签名服务。`policy` 绝不 checkout，也不运行
git/npm/node/cargo 或任何仓库脚本，只校验 dispatch 输入、直接 `main`
保护、Stage-B 审批规则和按候选格式条件化的公开身份变量。

GitHub API 不能从 workflow 内证明这个 fine-grained token 实际没有被管理员
授予额外权限。首次候选和每次轮换时必须在仓库外复核 token owner、唯一目标
仓库、只读权限、到期时间与审计记录；该人工记录是外部发布 blocker，不能把
“脚本只发送 GET”误写成 token 权限已经由机器证明。

工作流严格只有两个 GitHub-hosted Windows job：

1. `policy`：可以挂载受保护的 `windows-release-stage-b`，但只有
   `contents: read` 和一个只读 policy token；两种格式都读取
   `ATLASTERM_WINDOWS_LEGAL_PUBLISHER`。仅 EXE 回退读取并校验
   `ATLASTERM_WINDOWS_CERTIFICATE_SUBJECT` 与
   `ATLASTERM_WINDOWS_CERTIFICATE_THUMBPRINT`；MSIX 的两个证书 output
   必须为空。
2. `verify`：不挂载 environment，没有 OIDC、签名 secret 或 policy token，只有
   `contents: read`、`actions: read` 与 job-scoped `github.token`。它 checkout
   `policy` 输出的精确 SHA，以
   `npm ci --ignore-scripts` 安装依赖，生成并复核法律资源和四份 SBOM，
   执行真实 Store surface build 与 Playwright runtime 验证。HTTPS 模式从
   `artifact_url` 下载；artifact 模式用 full-SHA pinned
   `actions/download-artifact` 按精确 run/ID 下载 raw MSIX、source evidence 与
   两份 Sigstore bundle，并启用 `digest-mismatch: error`。raw MSIX 使用
   `skip-decompress: true`；下载后先限定唯一 canonical 文件名，再由 Node verifier
   现场读取 run/artifact metadata，验证 workflow path/id、success、attempt、同一
   repository/main/head SHA、artifact name/digest/size/expiry 和候选实际字节。
   密码学验证只读取本地 bundle 与 pinned trusted root，要求唯一 subject、证书
   identity、SLSA predicate 和项目 build-bindings predicate 全部精确一致，然后生成
   `github-actions-source-provenance.json` receipt。
   EXE 会真实 `/S` 安装、全 PE 验签和 `/S` 卸载；MSIX 会做
   manifest/Partner identity/PE/签名状态校验。

artifact 模式固定使用
`scripts/trusted-roots/github-attestation-trusted-root-2026-08-31.jsonl`，SHA-256
为 `65ca537f6ed8a47fd0e560c421baa1f6c1efb8b25fc200d8c5c02c0e92eb2b9c`。
验证器固定 GitHub CLI `2.95.0` 的官方 Windows amd64 archive 与已签名
`gh.exe`；archive SHA-256 为
`19a7154161ada9cfaa9e57edb752ecc679b75c391a62e4f7b586eea1df30b5bb`，
executable SHA-256 为
`cfefbc730f2ef7dc0352d6a5435b72fe6afce7fc56d61c90eb7703cd5d97b149`。
archive 树、版本输出、GitHub, Inc. Authenticode subject 与 thumbprint 也必须匹配。
`gh` 密码学验证子进程不继承 GitHub/OIDC token 或用户配置，并把代理指向本机拒绝
端口；receipt 如实记录 `osNetworkIsolation: not-enforced`，不能声称操作系统阻断了
所有 direct socket。

`verify` 在执行候选前记录 clean reviewed HEAD、workflow、完整 Store `dist`
文件树、法律资源和四份 SBOM 的 hash；执行后、上传前再次比较这些基线，并要求
HTTPS 模式的证据目录恰好只有审核过的五个文件；artifact 模式再增加一份来源
receipt，且 checksum manifest 必须精确覆盖全部文件。这能阻断普通
安装器污染或复核后篡改，但同一 runner 上主动恶意的 native binary 仍不属于
这套 candidate-only 执行证据的信任边界；更强生命周期保证仍需要隔离 clean VM。
artifact 模式可以声明精确 source build 的 authenticated provenance，但该 receipt
不证明安装、WACK、Partner Center 上传、Store 签名、认证或发布；HTTPS 模式始终
不能声明 authenticated provenance。

verifier 每次运行都把 live metadata digest/size/timestamps/expiry、三个 artifact ID、
两个 bundle hash、签名 identity 与 transparency log 写入 receipt。候选 preflight
再次精确核验 receipt，并把它与候选证据放入不可覆盖的 Actions artifact。源 artifact
到期后必须从包含同一通用 verifier 的新 protected-main commit 重新生产；不得通过
后续源码提交硬编码旧或新 tuple。

`windows-release-stage-b` 的公开身份变量按格式区分：

| 名称                                       | 要求     | 用途                                                           |
| ------------------------------------------ | -------- | -------------------------------------------------------------- |
| `ATLASTERM_WINDOWS_LEGAL_PUBLISHER`        | 两种格式 | 精确法定名称；绑定 ARP、证书 CN 与 Partner Center display name |
| `ATLASTERM_WINDOWS_CERTIFICATE_SUBJECT`    | 仅 EXE   | 预先审批的完整 X.509 subject                                   |
| `ATLASTERM_WINDOWS_CERTIFICATE_THUMBPRINT` | 仅 EXE   | 预先审批的 40 位证书公有 thumbprint                            |

`policy` 始终要求 legal publisher 精确存在并拒绝占位值或换行；仅 EXE
要求两个证书变量，并要求 subject 中唯一 CN 等于法定发布者。MSIX 不查询
证书变量，证据也拒绝出现证书字段。Stage-B 和仓库都不得保存私钥、PFX、口令、
长期云凭据或 managed signer 配置。MSIX 的 `partner_identity_base64` 是
dispatch 输入中的公开包身份 JSON，不是 secret；它只写入 verify runner
临时目录并在结束时删除。

所有 action 都固定为完整 commit SHA，Node 固定为 `22.22.2`，npm 固定为
`10.9.7`，Rust 固定为 `1.96.0`。验证证据记录 reviewed commit、选定 source、
候选 SHA-256、candidate JSON、来源 receipt、法律资源、SBOM、真实 Store surface 与实际
runner/toolchain 摘要；这些记录用于审计，不把可变 runner image 或操作员
输入误称为可复现构建或 authenticated provenance。

候选证据分别记录 `preflightCommit` 与 `artifactSourceCommit`，并记录规范化
repository、workflow run、Node、脚本版本与脚本 SHA-256。`policy` 复核的
公开身份输入会放入单独的 attestation 区域，但候选 JSON 与它自己生成的
`SHA256SUMS.txt` 都只属于本地完整性证据，**不能**标成 authenticated
provenance。公开或提交商店前，已审核的通用 verifier 必须按候选运行输入的精确
tuple 和 pinned trusted root 验证 producer 的两份 Sigstore bundle，并输出绑定 live
artifact metadata 与 bundle hash 的 receipt；只有该 receipt 通过后，才能把绑定仓库、
源码提交、run、工具身份和 artifact SHA-256 的结果计入发布证据。

hosted `workflow-evidence.json` 使用 schema v2，并固定记录
`preferredFormat: "msix"`、实际选择格式、是否回退 EXE 和完整回退原因。
MSIX identity 只允许 legal publisher；EXE identity 才允许证书 subject 与
thumbprint。上传前会再次按格式复核字段 allowlist、选择决策与说明，不能在
预检后抹除回退原因或向 MSIX 证据塞入无关证书字段。

工作流不调用 Partner Center、不提交商店、不发布 Release。输出的
`candidate.json` 始终保留：

EXE 必须是：

```json
{
  "storeSubmission": {
    "status": "not-submitted",
    "certificationStatus": "not-run",
    "storeSignatureStatus": "not-applicable-publisher-signature-required"
  }
}
```

MSIX 必须是：

```json
{
  "storeSubmission": {
    "status": "not-submitted",
    "certificationStatus": "not-run",
    "storeSignatureStatus": "not-issued"
  }
}
```

Windows App Certification Kit、真实更新行为、Partner Center 提交与认证
仍是后续人工 gate。在认证通过且正式产品 URL 可访问之前，不应展示
Microsoft Store 徽章，也不应把候选证据称为商店发布证据。

上架文案、真实产品截图、Store art、Privacy/Support URL、Markets、
Discoverability、账号类型和认证备注的独立收口清单见
[Microsoft Store listing draft](microsoft-store-listing-draft.md)。候选绑定的
八张 en-US/zh-CN 截图、1:1/2:3 品牌图和 SHA-256 manifest 流程见
[Microsoft Store asset preparation](windows-store-assets.md)；公开隐私/支持页的
无个人信息模板与未登录网络检查见
[Microsoft Store public pages](store-public-pages/README.md)。

## Store 功能表面门禁

Store overlay 固定使用 `npm run build:microsoft-store`，该命令以 Vite
`microsoft-store` mode 构建前端。此 mode 与普通 production 构建都采用
fail-closed 策略：Business/Team、录制、加密片段 Sync，以及 Web Admin /
Mobile 伴随产品介绍均不进入可见 UI；只有 `development`、`test` 或显式
`future-preview` mode 才显示这些原型表面。旧版本持久化的 Team 面板状态会
安全回落到 Inspector，`Ctrl+3` 和历史命令也不能重新打开 Team。

候选前必须运行：

```powershell
npm run qa:windows-store-surfaces:runtime
```

该门禁会安装锁定依赖中的 Playwright Chromium，执行真实 Store 前端构建，
验证 `dist/index.html` 中唯一的
`joessh-release-surface-profile=microsoft-store` 构建标记，并在真实构建产物
上覆盖窄窗口、明暗主题、直接 Team URL、`Ctrl+3`、命令面板、快捷键、Settings
隐藏项和水平溢出。不要用普通 `npm run build` 生成的 `dist` 代替 Store
候选前端，也不能只运行静态 `qa:windows-store-surfaces` 冒充正式 runtime
证据。
