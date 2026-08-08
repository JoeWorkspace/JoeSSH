# JoeSSH 0.1.0-beta.19 发布准备手册

> `v0.1.0-beta.18` 是已推送到远端、但没有 GitHub Release 的 tag-only 预检
> 标签：dry-run 在创建 Release 前失败。该标签必须保持不删除、不移动、不补建
> Release、不复用；本手册只操作 `v0.1.0-beta.19`。

本手册是个人维护者的 Windows-first 收口入口。当前代码版本是
`0.1.0-beta.19` 候选，不是已经获批的安装包、商店版或付费版。任何门禁
失败都表示继续准备，不表示可以通过改文案、改 JSON 或手工上传来绕过。

## 本轮目标与边界

- 第一条用户验证路径：Windows Desktop 邀请测试。
- 第一条公开分发候选：JoeSSH Community 的 Microsoft Store 路径。
- Community 的 SSH、PTY、SFTP、端口转发、host-key 保护和本地配置保持
  免费、MIT 许可。
- Founder/Pro 目前只是价格与付费价值假设；托管 Sync、团队 SaaS、SLA、
  macOS/Linux 商业支持和 Mobile 公开分发均不在本轮承诺内。
- 不把 GitHub Actions 候选、未签名安装包或本地生成的 JSON 称为商店
  认证证据。

完整公开 Desktop/Web/Sync 多平台发行仍由
[Public Beta release checklist](release-checklist.md) 管理。它与本手册的
Windows-first 邀请/Store 候选不是同一发布档案，不能互相冒充证据。

## 1. 源码收口

只在健康 Git worktree 中执行：

```powershell
npm run release:history-secret-scan
npm ci
npm run qa:release-preparation
npm run qa:beta:windows:contract
npm run qa
```

第一遍完整历史泄密扫描必须发生在安装任何第三方依赖之前；`npm ci` 之后的
`qa:release-preparation` 会再次执行同一真实扫描，并补齐发布合同检查。两次扫描都
必须使用精确的 Gitleaks `8.30.1`，不能用合同测试或工作区扫描代替。

在一次性 Windows 发布机上，再运行带真实本地 OpenSSH fixture 的门禁：

```powershell
npm run qa:beta:windows:fixture
```

`qa:release-preparation` 会先执行新增发布合同和 Community 商业边界检查，
再实际调用 `release:history-secret-scan` 扫描所有 Git refs 的完整历史。它不
证明证书、商店、支付、远端仓库设置或真实设备已准备好。

本地和 CI 的可复现工具链固定为 Node `22.22.2`、npm `10.9.7`、Rust
`1.96.0` 与 cargo-audit `0.22.2`。`rust-toolchain.toml`、Cargo
`rust-version`、所有 `setup-node`/`dtolnay` step 和结构化合同必须保持一致；
所有 workflow `npx` 调用都使用 `--no-install`，缺失本地依赖时直接失败。
`.gitattributes` 将源码、lock、配置和发布输入统一为 LF，并显式保护二进制
产物不受换行转换影响，避免 Windows 与 CI 对同一输入计算出不同 hash。

发布机必须在 `PATH` 中提供精确的 Gitleaks `8.30.1`；缺少工具或版本不一致
都会明确失败。仅需调试合同测试时可运行
`npm run qa:release-preparation:contracts`，但该命令不包含真实历史扫描，
不能作为 CI 或发布证据。

```powershell
npm run release:history-secret-scan
```

CI 的 Ubuntu lint job 会从 Gitleaks 官方 `v8.30.1` release 下载
`gitleaks_8.30.1_linux_x64.tar.gz`，在解压前验证官方 SHA-256
`551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`，
再校验二进制版本。lint checkout 使用完整历史（`fetch-depth: 0`），并在
`npm ci` 或任何第三方 lifecycle script 运行前，通过受校验二进制的绝对路径
执行第一次真实扫描；`.gitleaks.toml` 与 `.gitleaksignore` 也由固定 SHA-256
约束。依赖安装后的发布准备门禁仍显式传入同一绝对路径，不依赖可被安装脚本
改写的 `PATH`，不得改回 shallow clone 或把首次扫描移到依赖安装之后。

该命令使用 100% redaction，不向仓库写 report。任何 finding 都先按真实凭据
泄露处理并轮换；历史改写会影响所有协作者和标签，必须另行评审，不能由扫描
脚本自动执行。

仓库仅忽略 9 个已人工复核的历史测试/演示 fixture，并以
`commit:file:rule:line` 精确 fingerprint 绑定在 `.gitleaksignore`。检查脚本会
拒绝任何额外 fingerprint，也会拒绝在 `.gitleaks.toml` 添加规则级 allowlist；
因此未来提交中即使出现相同形态的值，也必须重新报警和评审。

## 2. 远端 GitHub 控制

以下命令只读，不会修改仓库、环境、secret、Actions 或账单：

```powershell
npm run release:github-controls -- --repo JoeWorkspace/JoeSSH
```

发布前必须全部为 PASS：

- 仓库公开，默认分支为 `main`；
- `main` 必须通过
  `/repos/<owner>/<repo>/branches/main/protection` 暴露可读取的直接 classic
  branch protection：精确要求 GitHub Actions App 提供的
  `Public Release Readiness`，要求 PR、线性历史和讨论全部解决，对管理员同样生效且
  没有 PR bypass allowance，并阻止 force-push 与删除；当前单维护者模式把审批数
  固定为 `0` 并关闭 latest-push approval，由维护者在最新 push 后复核最终 diff，
  因为 GitHub 不会把 PR 作者对自己 PR 的批准计入门禁；这属于自审，不是独立审核。
  active ruleset 可以追加更严格约束，但不能替代这套直接保护；
- Private Vulnerability Reporting 已启用；
- `windows-invite-stage-a` 与 `windows-release-stage-b` 环境都把仓库所有者设为
  required reviewer，允许 self-review、阻止 admin bypass，且只允许 protected
  branches；这是单维护者的人工暂停点，不得表述成独立安全审核；
- 正式 Desktop 签名自动化保持禁用；repository scope 不得存在历史
  Windows/macOS 签名与公证 secret，敏感签名材料留在仓库外，unsigned workflow
  不能生成正式签名证据；
- Actions artifact/cache 摘要可读；
- 维护者在 GitHub Billing 页面确认仓库保持 public、只使用 standard hosted
  runners、未启用 larger runner，artifact/package 与 cache 未超过免费额度，并
  通过零付费预算或不配置付款方式让超额使用直接被阻断；随后使用
  `--confirm-billing-ready` 记录人工确认。GitHub Free 不要求充值。
- Store policy 使用的 fine-grained token 由操作员在仓库外复核 owner、唯一目标
  仓库、只读权限、到期时间与审计记录；workflow 只能限制自己的 GET 调用，
  不能证明管理员没有给 token 额外权限。

脚本不会删除 artifact/cache，也不会替维护者修改任何远端设置。

## 3. 商业与政策门禁

免费 Community 源码边界：

```powershell
npm run qa:commercial:community
```

Microsoft Store 政策边界：

```powershell
npm run release:windows-store:policy-preflight -- `
  --partner-identity reports/handoff/windows-store/partner-center-identity.json `
  --support-url "https://<真实域名>/support" `
  --privacy-url "https://<真实域名>/privacy" `
  --confirm-public-links
```

该命令通过单一 wrapper 接收 `npm run --` 后的参数：它从 gitignored 的规范
Partner Center identity 文件读取卖方/Windows 法定发布者，不在命令行或报告中
打印个人姓名；Privacy/Support URL 同时传给 commercial 和未登录网络 checker，
远程页面必须包含同一精确姓名，但仓库内政策源文件不得包含它。URL 不得带 query，
避免预览 token 进入 argv 或检查报告。
不要把姓名改回 argv，也不要把两个 checker 拆成 shell 尾接命令，否则会泄露
命令历史，且 npm 追加的参数只会到达最后一个进程。

未来付费边界：

```powershell
npm run release:commercial:preflight -- `
  --seller-name "<真实卖方名称>" `
  --merchant-of-record "<真实 MoR 法定名称>" `
  --governing-law "<真实适用法律与强制消费者权利说明>" `
  --support-url "https://<真实域名>/support" `
  --privacy-url "https://<真实域名>/privacy" `
  --checkout-url "https://<真实结算域名>/<产品>" `
  --customer-portal-url "https://<真实结算域名>/<客户入口>" `
  --confirm-public-links `
  --confirm-live-commerce
```

免费 Store 模式当前应当失败，直到 `SUPPORT.md`、`PRIVACY.md`、真实卖方和
未登录可访问的支持/隐私 URL 完成并由维护者显式确认。Paid 模式还必须完成
退款、销售条款、卖方/商标主体、MoR、适用法律、客户入口、真实购买、交付、
恢复、取消、退款、失败付款和提现演练。`{{...}}` 不是待发布文案，而是故意
保留的阻断器；删除占位文字本身不会让门禁通过。

`.github/FUNDING.yml` 在验证收款账号所有人、未登录展示页、付款限制/非购买说明、
小额付款和提现之前保持纯注释，同时
`.github/funding-operator-attestation.json` 保持精确 `inactive` 状态。启用时
两个文件必须在同一审核 commit 中绑定完全相同的 URL、五项 `true` 和不超过
180 天的真实验证日期；普通 `qa:commercial:community`/CI 随后无需 CLI 确认。
自愿支持与购买软件权益必须在页面上明确分开。

## 4. Windows 邀请测试

Stage A 只用于 3–5 名可信技术测试者：

1. 确认仓库仍为 public，并用只读门禁复核现有的 protected `main`、PVR 和
   `windows-invite-stage-a` 环境；这些控制已经配置，不要重复创建。
2. 从 protected `main` 手动运行
   `.github/workflows/windows-invite-beta.yml`。
3. 在与构建 runner 分离的干净环境核对 workflow summary 中的完整 commit、
   artifact ID/digest 和安装包 SHA-256。
4. 在隔离 Windows VM 完成安装、启动、host-key、PTY、SFTP、端口转发、
   重启、卸载/回滚和 Defender 检查。
5. 使用 `release:desktop:promote:windows-invite` 生成不可覆盖的 Stage A
   邀请批准证据。

Stage B 仍是明确 No-Go。可信 Authenticode、时间戳、Defender、干净 VM、
零 P0/P1、维护者最终 diff 自审和与构建 runner 分离的复核未全部形成证据前，
不扩大到 10–30 人，也不收费。维护者批准属于自审，不是独立审核。
详见 [Windows invite Beta playbook](windows-invite-beta.md)。

## 5. Microsoft Store 候选

优先做一次限时一天的 MSIX Packaging Tool 可行性验证；只有出现已记录的真实兼容
阻塞时，才回退到 Tauri 原生 NSIS EXE：

1. 本次发布已经确认由无公司的个人维护者以免费、开源、非商业 Community
   项目发布，因此使用 Individual onboarding。完成个人身份验证后，法定发布者
   必须逐字采用 Partner Center 显示的本人姓名；不能使用 `JoeSSH`、
   `JoeSSH Project`、GitHub 用户名或虚构工作室名。随后保留产品名称并复制真实
   package identity。Individual 不能原地转换为 Company；如果以后改为以
   自由职业、个体经营或其他商业身份发布，应在商业活动开始前重新核对资格并
   单独办理适用的 Company 路径。
2. 取得真实 Partner Center package identity 后，用 Microsoft MSIX Packaging
   Tool 对精确 release build 做一天的外部打包试验，运行 WACK，并验证 SSH、
   PTY、SFTP、本地端口转发、WebView2、安装、升级、卸载和回滚。Store-only
   MSIX 在认证后由 Microsoft Store 免费重签、托管和更新，不需要为 Store 提交
   单独购买公开 CA 代码签名证书；认证前必须保持
   `pending-microsoft-store-signing` 真值。
3. 如果 MSIX 试验发现无法在一天内解决的兼容阻塞，才回退到 NSIS。NSIS 路径
   必须在 workflow 外用公开信任 CA 证书和可信时间戳签署安装器及所有已安装 PE，
   使用不可变、带版本的公开 HTTPS 下载地址，并由发布者自己承担托管和更新。
4. 为待验证的 EXE/MSIX 同一字节提供可直接下载的 HTTPS transfer URL，记录
   完整 SHA-256；两种格式都不得省略 URL 或 hash。EXE 直发 URL 还必须不可变
   且带版本；MSIX URL 只承担 hash-bound 验证传输，后续向 Partner Center
   提交同一 SHA-256 的包，不把该 URL 误称为长期托管或不可变性证明。
5. 用只读门禁复核现有受保护的 `windows-release-stage-b` environment；该环境
   已经配置，不要重复创建。配置仍缺少且始终必需的
   `ATLASTERM_WINDOWS_LEGAL_PUBLISHER` 和只读 policy token。只有已经证明
   MSIX 兼容阻塞、明确回退 EXE 时，才额外配置公开的证书 subject/thumbprint
   变量；MSIX 不要求也不允许伪造证书身份。不得在该 workflow 中配置签名
   secret、OIDC、self-hosted signer 或本地 handoff。
6. 在 protected `main` 手动运行 hosted-only
   `.github/workflows/windows-store-candidate.yml`，传入 `artifact_url`、
   `expected_sha256` 和精确 `reviewed_sha`。`candidate_format` 默认
   `msix`；选择 `exe` 时必须提交 40–1000 字符、无占位/控制字符的
   `msix_fallback_justification`，选择 MSIX 时该输入必须为空。
7. 无签名权限的 hosted `verify` 必须先运行
   `npm run qa:windows-store-surfaces:runtime`，对真实 Store 构建执行静态合同与
   Playwright 窄窗口、明暗主题、快捷键、命令面板和隐藏功能入口检查，再验证
   EXE 的安装器/已安装 PE 签名、
   时间戳、静默安装/卸载，或验证 MSIX identity/manifest/Store-signing 状态；
   两条路径都必须复核法律资源、四份 SBOM、真实 Store surface、commit 和
   托管字节 SHA-256，并在执行候选前后比较 clean HEAD、workflow、完整 Store
   `dist` 与法律/SBOM hash。该同 runner 基线只阻断普通污染，不替代隔离
   clean VM 或 authenticated provenance。
8. 在与构建 runner 分离的 clean VM 中复核 exact SHA-256 候选和托管证据；
   不能把会执行未经信任 native binary 的同一 hosted runner 当作独立
   provenance 信任根。
9. 完成 Windows App Certification Kit、Partner Center 提交、认证、更新和
   回滚演练后，才可以展示 Store 徽章。

本地 `release:windows-store:build` 与 `--artifact` 预检只用于隔离开发机诊断，
不在 privileged workflow 中，其本地 JSON、checksum 或安装包不能作为正式发布证据。

Partner Center 的 en-US/zh-CN 文案、截图计划、隐私声明、账号类型、Markets、
Discoverability 与许可证字段由
[Microsoft Store listing draft](microsoft-store-listing-draft.md) 管理。该文件仍是
fail-closed 草案，不能替代真实的发布者身份、公开链接、候选截图或商店认证证据。

Tauri 2 不原生生成 MSIX。选择 MSIX 时，必须先取得真实 Partner Center
package identity，再用微软工具外部打包；不能把 NSIS 改后缀或把未认证包
写成 “Store 已签名”。细节见
[Windows Store release guide](windows-store-release.md)。

## 6. 版本、标签与发布证据

- 旧的 `v0.1.0-beta.9` 标签永久保留，不移动、不覆盖。
- `0.1.0-beta.19` 永久限定为零上传资产的 source-only prerelease；不能在发布后
  补传 Desktop、Web、Sync、Mobile、Store 或其他二进制制品，也不能复用标签。
- 只有候选改动已通过 PR 合并到受保护的 `main`、目标门禁全部绿色，且外部
  blocker 已关闭后，才创建指向精确候选 commit 的
  `v0.1.0-beta.19` annotated tag。
- 确认 `reports/release/` 没有任何文件后，依次运行：

  ```powershell
  npm run release:source-prerelease -- --confirm-billing-ready --dry-run
  npm run release:source-prerelease -- --confirm-billing-ready
  npm run release:source-prerelease:verify
  ```

  专用入口先创建私有 draft，复核零资产、精确 tag、受保护 `main`、required
  check 和 GitHub controls，再直接发布并独立验证；本轮不存在需要重新下载和
  复核 SHA-256 的上传制品。

- `npm run release:publish-preflight` 是 beta.19 之后某个独立、未使用版本的完整
  Desktop/Web/Sync 多平台公开发行门禁，不得用于修改 beta.19，也不是 Windows
  Store 候选的快捷通道。缺少 macOS/Linux 或正式 Desktop 证据时，它正确地
  保持失败。

## 7. 个人维护者的外部办理顺序

1. 重新确认 GitHub Free、standard hosted runners、artifact/cache 免费额度，
   并确保付费超额使用仍被阻止。
2. 重新运行只读 GitHub controls，确认现有 `main` 保护、PVR 和两个受保护环境
   仍通过；这些控制已经配置，不要重复创建。
3. 用 3–5 名可信测试者完成 Stage A，修完 P0/P1。
4. 以已确认的 Individual 类型办理 Partner Center、保留产品名，先完成一天的
   MSIX 可行性验证；只有失败时再办理 NSIS 所需的可信代码签名。
5. 当前 Community 发布保持 checkout、付费权益和付费支持全部关闭。仓库可以
   单独展示无回报的自愿支持页，但 Store 文案、应用界面、发布包、下载和更新
   不得链接或宣传该入口，也不能为了收款把当前免费 Store 分发描述成付费产品。
6. GitHub Funding 按钮继续关闭，直到逐个核对页面中的收款方式资格、账号
   所有人、未登录桌面/移动展示、付款限制/非购买说明、小额付款与提现；通过后在
   同一审核 commit 提交精确页面 URL 和当前 operator attestation，且不承诺
   软件权益。正式提交 Individual Store 版本前，还需确认独立仓库支持页不会
   改变 Partner Center 对本次免费、非商业 Store 分发的账户资格判断。
7. 达到至少 10 名重复使用者和 5 名真实支持者后，只开始 MoR 申请、
   访谈和 Founder/Pro 非售卖原型；真正开售仍须达到 30 名外部 Windows 用户
   完成 SSH、且 10 人提出同一付费需求等更高门禁。
8. 托管 Sync 与团队服务延后，直到多设备/团队需求、备份恢复、账号删除、
   事故响应和个人值守能力都被证明。

## Go 条件

只有以下条件同时成立，才可以把候选称为“可发布”：

- 精确 commit 的源码、Windows fixture 和候选合同全部通过；
- 完整 Git 历史的 redacted Gitleaks 扫描通过；
- 远端仓库、PVR、分支和环境保护可由只读检查证明；
- 安装包签名、时间戳、SHA-256、安装/升级/卸载/回滚与安全扫描有绑定证据；
- 当前发布模式实际需要的 Store/支持/隐私主体和链接已配置并从未登录环境
  验证；只有付费发布才要求支付主体与链接；
- 没有开放 P0/P1，没有把待办模板或人工口头确认当成机器证据。
