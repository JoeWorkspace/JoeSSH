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
2. `MSIX`：在 Partner Center 保留应用身份之后，用微软官方工具从外部
   单独打包和验证。它不是 Tauri bundle，也不能标成 Tauri 产物。

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

## 推荐次序：先做一天 MSIX 可行性验证

Microsoft 当前建议大多数新应用优先使用 MSIX；Store 可以在认证后免费重签、
托管和更新 Store-only MSIX。对个人维护者，这通常比购买公开 CA 证书并长期
维护 EXE 托管/更新更省成本。因此取得真实 Partner Center identity 后，先用
Microsoft MSIX Packaging Tool 做限时一天的可行性验证：对精确 release build
打包，运行 WACK，并实际验证 SSH、PTY、SFTP、本地端口转发、WebView2、安装、
升级、卸载和回滚。通过就以 MSIX 作为免费 Community 的首选 Store 路径；
只有出现有证据的兼容阻塞时，才回退到下述 NSIS 路径。

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

`.github/workflows/windows-store-candidate.yml` 是 **hosted-only 验证
workflow**：EXE 和 MSIX 都必须先由 workflow 外部生成，并通过可直接下载的
HTTPS transfer URL 同时提供必填 `artifact_url` 与 `expected_sha256`。EXE
直发路径还必须使用不可变、带版本的长期 URL；MSIX URL 只作为按 hash 绑定的
验证传输输入，不构成长期托管或不可变性证明，后续必须把同一 SHA-256 的包提交
Partner Center。workflow 中没有 build/sign job、self-hosted runner、OIDC、
签名 secret、managed signer 或本地 handoff，也不接受 `--artifact` 路径。
仓库和 Actions 中仍然**禁止保存、base64 编码或临时导入 PFX**，但这项禁令
不能被误读为仓库已经提供了替代签名服务；当前只验证外部提供的已签名 EXE。

`npm run release:windows-store:build` 与本地 `--artifact` 预检仍保留供开发者
在隔离 Windows VM 中诊断。它们不在 privileged workflow 中，产生的本地
JSON、安装包或 checksum **不能作为正式发布证据**，也不能绕过 hosted URL、
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

## 首选可行性路径：外部 MSIX

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

真实转换使用 `release:windows-store:msix-sandbox` 在 gitignored `reports/`
目录创建一次性 Windows Sandbox staging。生成器要求 clean reviewed HEAD，
该命令会直接调用 `release:windows-store:build` 的构建函数，在构建前后复核 clean
HEAD，并在 NSIS 旁生成唯一的 `.build-provenance.json`，把源码提交、项目版本、
文件名、大小和 SHA-256 绑定在一起；Sandbox 生成器在同一进程中立即读取相邻
证据，并与实际 NSIS 和当前 HEAD 逐项交叉验证，不接受操作员指定的旧安装包、
artifact source 或安装包哈希。转换前若发布工具有改动，必须先提交。
staging 父目录及新建目录在写入和失败清理前都会逐级拒绝 symlink、junction、
reparse point 和真实路径越界。它固定核验 Microsoft MSIX Packaging Tool
`1.2024.405.0`、离线许可证和 Windows 11 x64 driver CAB 的 reviewed SHA-256，
然后只向 Sandbox 映射只读 input 与独立可写 output；网络、剪贴板、音频、视频
和打印机重定向全部关闭。真实 Partner identity 只写入 private conversion XML，
不会出现在命令行、`plan.json`、状态文件或终端输出中。

NSIS 自解压 bootstrap 本身是 x86 PE，但其安装载荷必须是精确的 x64
`atlasterm-desktop-shell.exe`。构建 provenance 会分别绑定 bootstrap 和 payload
的架构、文件名、大小与 SHA-256；不能用 bootstrap 位数替代载荷架构判断。转换后
仍须由 MSIX manifest 和解包 payload 的独立预检确认最终包为 x64。

```powershell
npm run release:windows-store:msix-sandbox -- `
  --tool-bundle <官方离线msixbundle> `
  --tool-license <官方离线License.xml> `
  --driver-cab <官方Windows-11-x64驱动CAB> `
  --partner-identity reports/handoff/windows-store/partner-center-identity.json `
  --reviewed-sha <完整clean HEAD>
```

生成的 `.wsb` 会在容器中用 `/S` 运行精确 NSIS，省略所有签名输入，并只把
MSIX、阶段状态与最终 SHA-256 写回 output。Packaging Tool 详细日志只留在
一次性 Sandbox 内；失败状态不会回传可能含 identity 的错误正文。此步骤只生成
未签名 Store 输入，不代表 WACK、功能验证、Partner Center 提交或认证通过。

workflow dispatch 以 `partner_identity_base64` 接收这份公开 Partner Center
identity JSON；它不是 secret，也绝不能包含令牌或签名材料。`policy` 只做
输入语法和实时策略检查，`verify` 在 runner 临时目录解码并在结束时删除。
`verify` 不挂载 environment、没有 `id-token: write`，也不读取任何
`${{ secrets.* }}`。脚本能证明 manifest 与输入完全一致，但不能离线证明
这些值确实由 Microsoft 分配。因此候选证据会明确记录该限制，名称保留或
本地匹配都不能当成商店认证证据。

```powershell
node scripts/prepare-windows-store-candidate.mjs `
  --format msix `
  --download-url https://downloads.example.invalid/joessh/1.0.0.0/JoeSSH.msix `
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
hosted-only 验证工作流；本文档**不声明远端仓库目前已经完成这些保护**。
EXE 与 MSIX 都必须填写非空 `artifact_url` 和完整 `expected_sha256`，没有
“URL 为空就本地构建”的分支。每次运行时，`policy` 会在受保护 environment
批准之后用只读 fine-grained token 实时读取 GitHub API，并要求：

- `candidate_format` 默认且首选 `msix`；选择 EXE 时必须提供 40–1000 字符、
  去首尾空格、无控制字符且非占位的 `msix_fallback_justification`，选择
  MSIX 时该输入必须严格为空；
- dispatch 必须来自受保护 `main`，`reviewed_sha` 必须与 `github.sha`
  完全相同；
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
2. `verify`：不挂载 environment，没有 OIDC 或任何 secret，也没有本地
   artifact/handoff。它 checkout `policy` 输出的精确 SHA，以
   `npm ci --ignore-scripts` 安装依赖，生成并复核法律资源和四份 SBOM，
   执行真实 Store surface build 与 Playwright runtime 验证，再从
   `artifact_url` 下载 EXE/MSIX 并按 `expected_sha256` 做 hosted preflight。
   EXE 会真实 `/S` 安装、全 PE 验签和 `/S` 卸载；MSIX 会做
   manifest/Partner identity/PE/签名状态校验。

`verify` 在执行候选前记录 clean reviewed HEAD、workflow、完整 Store `dist`
文件树、法律资源和四份 SBOM 的 hash；执行后、上传前再次比较这些基线，并要求
证据目录恰好只有审核过的五个文件且 checksum manifest 精确一致。这能阻断普通
安装器污染或复核后篡改，但同一 runner 上主动恶意的 native binary 仍不属于
这套 candidate-only 证据的信任边界；更强保证需要隔离 clean VM/独立 verifier，
不能把本流程升级描述为 authenticated provenance。

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
`10.9.7`，Rust 固定为 `1.96.0`。验证证据记录 reviewed commit、托管 URL、
候选 SHA-256、candidate JSON、法律资源、SBOM、真实 Store surface 与实际
runner/toolchain 摘要；这些记录用于审计，不把可变 runner image 或操作员
输入误称为可复现构建或 authenticated provenance。

候选证据分别记录 `preflightCommit` 与 `artifactSourceCommit`，并记录规范化
repository、workflow run、Node、脚本版本与脚本 SHA-256。`policy` 复核的
公开身份输入会放入单独的 attestation 区域，但候选 JSON 与它自己生成的
`SHA256SUMS.txt` 都只属于本地完整性证据，**不能**标成 authenticated
provenance。公开或提交商店前仍需一份由独立信任根验证、绑定仓库、源码提交、
run、工具身份和 artifact SHA-256 的签名构建 provenance。

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
