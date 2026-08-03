# JoeSSH Windows 邀请 Beta 执行手册

本文定义 JoeSSH 在 90 天内由个人开发者执行的、小规模邀请测试。目标是验证
Windows Desktop 的真实使用价值与安全边界，不是一次公开发布，也不是全平台承诺。

## 1. 范围与对外口径

本轮唯一交付物是 **JoeSSH Windows Desktop**：

- 仅接受 Windows 10/11 x64，要求系统能够安装或运行 Microsoft Edge WebView2。
- 验证 SSH 连接与主机密钥确认、PTY 终端、终端搜索、SFTP、端口转发、连接管理、
  设置、浅色/深色主题和常见 Windows 缩放比例。
- 目标规模为 10–30 名受邀测试者；不提供公开下载链接，不允许受邀者转发安装包。
- Mobile、Web Admin、托管 Sync、团队 SaaS、macOS/Linux 正式分发均不在本轮范围。
- Mobile/Web/Sync 即使出现在仓库或界面说明中，也不作为可用性、兼容性或支持承诺。
- 本轮不承诺 SLA、在线率、响应时限、修复时限、数据恢复或向后兼容。维护者只做
  best-effort 支持，并可随时暂停测试或撤回有风险的构建。

对测试者统一使用以下一句话：

> JoeSSH 邀请 Beta 是仅面向 Windows Desktop 的本地优先 SSH 工作台测试；它不含
> 云端托管服务，不适合生产关键路径，反馈按个人开发者能力尽力处理，不提供 SLA。

## 2. 两阶段准入

### 阶段 A：3–5 名可信技术测试者

目的：在小范围内消除安装、启动、连接和数据安全的硬故障。

- 测试者必须是能够理解 Authenticode、SHA-256、SmartScreen 和测试环境隔离的
  可信技术人员。
- 可以使用 unsigned internal staging，但只能点对点传递，必须在文件名、邀请消息
  和反馈记录中标注“未签名内部测试版”。
- 未签名包不得上传 GitHub Release、公共网盘、群文件或任何可被搜索的地址，也不得
  被描述为正式包、公开 Beta 或发布证据。
- 维护者必须先运行：

```powershell
npm run release:desktop:build:windows-invite
npm run release:desktop:package:windows-invite:stage-a
```

- 必须保存生成的 `reports/handoff/desktop/windows-invite/<candidate>/`。目录内的
  `candidate.json`、`SHA256SUMS.txt`、签名检查记录和安装包只属于内部交接证据，
  不得复制到 `reports/release/`。需要原始构建诊断时，可额外运行
  `release:desktop:unsigned-staging-report`，但它不能代替上述 fail-closed 打包门禁。
- 安装包 SHA-256 必须同时记录在 staging report 和点对点邀请消息中。SmartScreen
  警告必须提前说明；测试者不得因此形成“以后可忽略签名警告”的操作习惯。
- 阶段 A 只在专用测试主机、虚拟机或非生产账号上进行。

阶段 A 退出条件：

- 3–5 人全部验证安装/启动，并至少有 3 人完成 SSH 连接、主机密钥确认和 PTY 会话。
- 至少 2 人完成 SFTP 和端口转发验证。
- 没有未关闭的 P0/P1；卸载或回退到上一构建经过至少 1 次验证。
- 阶段 B 候选安装包已完成可信代码签名、时间戳和 SHA-256 清单。

### 阶段 B：扩到 10–30 名受邀测试者

阶段 B **禁止分发 unsigned 构建**。每个候选必须满足：

- Windows 安装包 Authenticode 状态为 `Valid`，签名者证书指纹与邀请消息一致，并
  带有可信时间戳。
- 安装包文件名、版本、Git commit、发布日期和 SHA-256 在发布记录中一致。
- 同目录提供 `SHA256SUMS.txt`；邀请消息再次独立给出 SHA-256。
- Windows Defender 扫描无告警；任何误报必须在分发前完成调查，不要求测试者关闭
  Defender 或添加目录白名单。
- 候选已通过第 3 节门禁，且没有未关闭的 P0/P1。
- 下载地址只发给登记过的测试者，并能在出现 P0 时立即撤回。

签名只证明包的来源和完整性，不代表软件已经稳定或适合生产。

## 3. 每个候选的发布门禁

维护者从干净工作树和固定 commit 构建。使用真实专用 SSH 测试环境时执行：

```powershell
npm ci
npm run qa:beta:windows:required
```

本地或 CI 使用仓库自带的隔离 OpenSSH fixture 时执行：

```powershell
npm run qa:beta:windows:fixture
```

`qa:beta:windows:source` 包含契约、lint、Desktop 单元测试与构建、SRI、安全头、包体、
Rust、Tauri、依赖审计及 Desktop 浏览器验收；`required` 再运行一次真实 SSH smoke；
`fixture` 由隔离 fixture 先运行一次 SSH smoke，再包装 `source`，不会重复 smoke。
真实 SSH smoke 必须使用专门的测试服务器和最低权限账号，不得使用生产跳板机。任何
命令失败都阻止分发，不以“只影响其他平台”为理由跳过共同依赖或 Rust 核心失败。

Playwright 的 Desktop 套件验证的是使用 Desktop 构建入口的 Vite 浏览器壳、响应式
布局和无障碍语义，不是已安装 Tauri、原生 IPC 或 Windows 安装器验收。每个候选仍
必须在干净 Windows VM 上完成安装、启动、重启、卸载/回退和真实 SSH 核心路径。

阶段 A 专用构建器先清空精确 NSIS 输出目录，再生成绑定完整 Git commit、四处版本、
PE 文件大小和 SHA-256 的 `windows-invite-build-attestation.json`。打包器随后拒绝
脏工作树、多安装包、旧版本文件、非 Windows/非 PE 文件、版本/attestation 不匹配、
复制中变更或非 `NotSigned` 状态；Git/PowerShell 证据命令不可用环境变量替换。
GitHub Actions 的手工工作流
`Windows Invite Beta` 也只生成 `stage-a-unsigned-internal-only` handoff artifact，
只允许从受保护的 `main` 分支运行，并把整个 job 绑定到
`windows-invite-stage-a` environment。仓库必须为该 environment 配置 required
reviewer（仓库所有者）、允许 self-review、关闭 admin bypass，并仅允许 protected
branches；单维护者先复核完整 40 位 commit SHA，再批准 job。该批准是防误操作的
人工暂停点，不是独立审核。操作者输入只通过
step environment 进入 PowerShell，且必须与 `github.sha` 完全一致。上传完成后，
step summary 会记录 reviewed commit、安装包 SHA-256、artifact ID/URL 与 artifact
digest；原生 VM 验收和 promotion 前须在工作流外独立核对这些值。状态固定为
`awaiting-native-smoke`；该 artifact 不能直接发给测试者。

完成干净 Windows VM 验收后，从模板复制证据到候选目录：

```powershell
Copy-Item docs/windows-invite-native-smoke.template.json `
  reports/handoff/desktop/windows-invite/<candidate>/native-smoke.json
# 用真实结果替换全部占位符后：
npm run release:desktop:promote:windows-invite -- `
  --candidate-dir reports/handoff/desktop/windows-invite/<candidate> `
  --reviewed-sha <工作流摘要中的完整 reviewed commit> `
  --expected-artifact-sha256 <工作流摘要中的安装包 SHA-256>
```

这两个外部锚必须从受信工作流的 step summary 独立抄取，禁止从候选目录内的
`candidate.json`、校验清单或原生验收 JSON 反抄；本地仓库还必须检出同一个完整
commit。promotion 会逐文件拒绝链接/重解析点/硬链接，基于稳定字节快照重新核对
真实 PE、完整 build attestation、单行 `SHA256SUMS`、精确 handoff 清单和现场
Authenticode `NotSigned`，并在写批准文件前后再次比较全部输入。它还要求 Defender
clean 记录绑定同一 SHA-256、安装/启动/重启/卸载或回退、host-key、PTY、SFTP、
端口转发全部通过，且开放 P0/P1 均为 0。最终生成新的、不可覆盖的
`invite-ready.json` 和独立清单，只授权 3–5 名可信技术测试者，不修改原始
candidate，也不会把它变成发布证据。

**Stage B 当前明确 No-Go。** `release:desktop:package:windows-invite:stage-b` 是一个
固定失败的阻断命令；在可信代码签名证书、固定 SignTool、时间戳、Defender 绑定和
已签名候选的独立 promotion 验证全部实现前，不能扩到 10–30 人。不得手工改写
candidate 或复用 Stage A approval 绕过此阻断。

`release:desktop:package` 是 Windows/macOS/Linux 正式发布证据的 fail-closed 聚合
流程；邀请 Beta 不调用它，不能伪造其余平台证据或冒充完整公开发布证据。

在发布机上为阶段 B 候选生成校验和：

```powershell
$installer = Resolve-Path "<installer-path>"
$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $($installer.Path | Split-Path -Leaf)" | Set-Content -Encoding ascii SHA256SUMS.txt
Get-AuthenticodeSignature -LiteralPath $installer |
  Format-List Status, StatusMessage, SignerCertificate, TimeStamperCertificate
```

分发前由第二次独立读取完成复核：

```powershell
$installer = Resolve-Path "<downloaded-installer-path>"
$actual = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
$expected = ((Get-Content .\SHA256SUMS.txt | Select-Object -First 1) -split "\s+")[0].ToLowerInvariant()
if ($actual -ne $expected) { throw "SHA-256 mismatch" }

$signature = Get-AuthenticodeSignature -LiteralPath $installer
if ($signature.Status -ne "Valid") { throw "Authenticode signature is not valid" }
$signature | Format-List Status, SignerCertificate, TimeStamperCertificate
```

复核人员还必须人工比较邀请消息中的证书指纹与 `SignerCertificate.Thumbprint`。
签名无效、证书指纹不符、缺少时间戳或哈希不一致时立即删除安装包并报告；不得点击
“仍要运行”绕过。

每个候选记录以下发布信息：

- 版本、Git commit、构建时间、构建机和测试负责人。
- 安装包文件名、字节数、SHA-256。
- Authenticode 状态、`SignerCertificate.Thumbprint`、时间戳验证结果。
- 门禁命令结果和真实 SSH smoke 的非敏感摘要。
- 已知问题、回退版本、撤回地址及受邀者名单。

原生 VM 验收记录必须绑定 `candidate.json` 中的完整 SHA-256，并至少包含：

- tester ID、测试时间、Windows build、WebView2 版本和显示缩放。
- 安装、首次启动、重启、卸载或回退、设置持久化。
- unknown/changed host-key、PTY、SFTP 和本地端口转发。
- 开放 P0/P1 数量必须均为 0；截图与日志必须声明已经脱敏。

完成验收前，`candidate.json` 中
`releaseEligible=false`、`inviteDistributionReady=false` 与
`nativeSmokeRequired=true` 不得被手工改写。验收通过后也保留这些原始值，以单独的
`invite-ready.json` 表达 Stage A 授权。“原生 VM 通过”只授权邀请范围分发，永远
不把该目录提升为公开发布证据。

## 4. 测试者安装与安全边界

测试开始前，测试者必须确认：

1. 只从私有邀请地址下载，并按第 3 节验证 SHA-256 和签名。阶段 A 必须知道当前是
   未签名内部构建；阶段 B 出现 unsigned 状态即停止。
2. 首次测试使用测试服务器、最低权限账号和可撤销凭据；不要使用生产 root、生产
   跳板机或唯一密钥。
3. 重要配置、远程文件和已有 SSH 数据已经独立备份。JoeSSH Beta 不承担备份工具或
   灾难恢复系统的角色。
4. 陌生主机的指纹通过可信的第二通道核对；changed host key 必须视为安全事件，
   不通过删除 known-host 记录来盲目绕过。
5. 命令安全拦截只是最后一道提醒，不是沙箱。不要粘贴破坏性命令，也不要用 Beta
   对生产主机做升级、删库、磁盘操作或权限变更。
6. SFTP 初次测试只使用可丢弃的小文件。遵守应用当前 25 MiB 单次传输安全上限，
   覆盖、上传和下载前核对目标路径。
7. 端口转发只绑定测试所需接口和端口；不要把数据库、管理面板或 SSH 端口暴露到
   公网。
8. 私钥、密码和 passphrase 留在本机；不通过反馈表、聊天、截图或日志发送给维护者。
9. 测试完成后关闭会话和转发；停止参与时卸载候选，并按邀请说明删除测试配置。

测试者按顺序验证以下 Desktop 路径，复用
[Public Beta dogfood](public-beta-dogfood-script.md) 的同一安全等级：

1. 安装、启动、重启、卸载或回退。
2. 创建连接，核对陌生主机指纹，确认 changed host key 被阻止。
3. 打开 PTY，执行无害 marker 命令，调整窗口、搜索、关闭并重新连接。
4. 尝试已知的 blocked command 测试样例，确认警告可见且会话仍可继续。
5. SFTP 列表、小文件下载/上传、覆盖确认和超限拒绝。
6. 启动本地端口转发、通过 loopback 验证、停止，并观察重复点击是否被合并。
7. 在 100%、125%、150%、175% 和 200% Windows 缩放中至少覆盖本人日常使用的一档，
   验证 1280×720 及更高分辨率；记录键盘、屏幕阅读器或高对比度问题。

Web Admin、Mobile、Sync device flow 和 Sync backup/restore 不在本轮任务清单内。

## 5. 隐私、遥测与日志脱敏

- 遥测默认关闭；只有测试者明确 opt-in 后才能发送最小化错误摘要。拒绝遥测不影响
  参与资格。
- 不收集 SSH host、IP、用户名、命令文本、终端历史或输出、远程/本地路径、文件名、
  文件内容、私钥、密码、passphrase、token、认证提示和剪贴板。
- 反馈使用随机 tester ID；姓名、手机号和邮箱与技术反馈分开保存。
- 截图前裁剪或遮盖标题栏、主机、用户名、路径、命令、输出、书签、通知和任务栏。
  维护者发现疑似秘密时必须停止处理、删除附件，并提醒测试者轮换相关凭据。
- 日志只保留版本、平台、locale、功能区域、已脱敏错误类别/堆栈签名和粗粒度时间。
  禁止要求测试者上传完整终端日志或整个应用数据目录。
- 支持附件通过私有渠道传递，不转贴到公共 Issue。Beta 结束后 30 天内删除原始附件
  和联系方式；只保留去标识化的缺陷统计与产品指标。
- 详细边界以 [Public Beta Privacy Note](privacy-public-beta.md) 为准；发生冲突时选择
  收集更少数据的规则。

## 6. 反馈表

使用私有表单或私有 Issue 模板。以下字段为最小集合；标有“必填”的字段不得省略：

| 字段                       | 要求                                                    |
| -------------------------- | ------------------------------------------------------- |
| tester ID                  | 必填；随机代号，不填真实姓名                            |
| 提交时间                   | 必填；ISO 8601，含时区                                  |
| JoeSSH 版本 / Git commit   | 必填；来自关于页或邀请消息                              |
| 安装包 SHA-256 前 12 位    | 必填；用于确认候选，不足以替代完整校验                  |
| Windows 版本 / build / x64 | 必填；例如 Windows 11 24H2 / 26100 / x64                |
| WebView2 版本              | 启动或渲染问题必填                                      |
| 显示环境                   | 必填；分辨率、缩放比例、显示器数量、浅色/深色/高对比度  |
| 功能任务                   | 必填；安装、host key、PTY、SFTP、转发、设置或无障碍     |
| 结果                       | 必填；成功 / 失败 / 阻塞 / 未测试                       |
| 严重级别                   | 必填；P0 / P1 / P2，定义见第 7 节                       |
| 期望行为与实际行为         | 缺陷必填；不得包含主机、路径、命令或输出原文            |
| 最小复现步骤               | 缺陷必填；使用占位符，如 `<test-host>`、`<remote-path>` |
| 重现率                     | 必填；例如 3/3、1/5                                     |
| 影响与恢复方式             | 必填；是否丢数据、是否需重启/卸载/回退                  |
| 网络环境                   | 连接问题必填；家庭/公司/VPN/代理，仅填类别              |
| 脱敏附件                   | 可选；勾选“已按第 5 节检查”后才能上传                   |
| 是否愿意下周继续使用       | 每周必填；是 / 否 / 不确定，并写一句原因                |
| 最希望解决的一件事         | 每周必填；只能选一项，防止需求无边界扩张                |

维护者每周只汇总：

- 邀请数、激活数、完成首次 SSH 连接人数。
- 核心任务完成率和 P0/P1/P2 数量。
- 第 2 周、第 4 周重复使用人数。
- 明确表示会每周使用的人数。
- 自愿赞助人数与金额区间；不把口头“愿意付费”当成实际付费。

不使用默认关闭的遥测推算上述数字；以测试者主动反馈和去标识化计数为准。

## 7. 成功、暂停和停止指标

严重级别沿用 dogfood 规则：

- **P0**：凭据/秘密泄露、数据丢失、非预期命令执行、host-key 防护绕过、安装包
  签名/哈希/来源失真、无法控制的公网暴露。
- **P1**：核心工作流死路、频繁崩溃、无法安全卸载或回退、关键状态误导、同一候选
  上可稳定复现的连接/SFTP/转发故障。
- **P2**：不阻塞核心任务的视觉、文案、低频兼容性或效率问题。

出现以下任一情况，立即撤回当前候选并暂停新增邀请：

- 任意 P0。
- 签名无效、证书指纹变化未解释、哈希不一致或下载地址疑似泄露。
- 两名测试者独立遇到同一 P1，或无法验证安全回退。
- 应用在未 opt-in 时发送遥测，或反馈/日志中出现未脱敏秘密。

恢复分发必须有修复、回归测试、全新版本/哈希和明确的受影响测试者通知。P0 涉及
凭据时，还必须提示轮换凭据。

90 天结束时，满足以下全部条件才认为 Desktop 邀请 Beta 成功：

- 10–30 人收到邀请，至少 10 人完成安装和首次 SSH 连接。
- 至少 8 人完成 PTY；在选择测试 SFTP/转发的人中，至少 80% 能独立完成相应任务。
- 没有未关闭的 P0/P1，最近两个候选没有新增 P0。
- 至少 6 人在第 2 周再次使用，至少 4 人在第 4 周再次使用。
- 至少 5 人明确表示会继续每周使用，并能指出一个具体价值点。
- 签名、校验和、撤回和回退流程均至少实操 1 次。

产品扩张使用更高门槛：只有达到 **10 名重复使用者 + 5 名实际赞助者**，才开始
访谈、申请支付渠道并原型验证一个 JoeSSH Founder/Pro 便利功能；这不授权收费。
Founder 的真实开售仍须达到 [pricing hypotheses](pricing-hypotheses.md) 中的
30 名外部 Windows 用户完成 SSH、且 10 人提出同一付费需求等门禁。未达到时保持
免费维护和范围收缩，不启动授权系统、托管 Sync 或团队 SaaS。

如果 90 天后激活不足 10 人、第 4 周重复使用不足 4 人，或没有人愿意持续使用，
停止新增功能 30 天，只修复安全和稳定问题，然后在“重新定位、维持开源维护、结束
投入”三者中做一次明确选择。

## 8. 90 天节奏

| 时间        | 人数与目标                       | 必须产出                                                                           |
| ----------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| 第 1–14 天  | 阶段 A，3–5 名可信技术测试者     | unsigned staging report、逐人安装记录、Desktop 任务 1–6 结果、P0/P1 清零、回退演练 |
| 第 15–30 天 | 签名门禁后进入阶段 B，累计 10 人 | 有时间戳的签名包、SHA256SUMS、私有下载、反馈表、每周缺陷摘要                       |
| 第 31–60 天 | 逐步扩到 10–30 人                | 每周一次分诊、最多双周一个候选、第 2/4 周留存、最高频的一项体验修复                |
| 第 61–75 天 | 停止扩功能，稳定核心路径         | P0/P1 清零、卸载/回退复验、隐私与附件清理、候选撤回演练                            |
| 第 76–90 天 | 复访与去留决策                   | 指标汇总、5 人小额赞助验证、下一阶段 Go/No-Go 记录                                 |

个人开发者每周固定一次 30–60 分钟分诊即可。内部工作目标可以是“P0 当日查看、
P1 在下一次分诊前分类”，但这只是维护节奏，不是对外 SLA。不要因为个别测试者的
定制需求打断安全修复、稳定性和留存验证。

## 9. 结束与 Go/No-Go

第 90 天生成一页去标识化结论：

- 范围、版本、邀请/激活/重复使用人数。
- 核心任务通过率和未关闭问题。
- 最常用的三个功能与最常见的三个放弃原因。
- 实际赞助人数与金额区间。
- 是否继续 Windows-first、是否只维持开源、或是否停止投入。

Go 只授权下一轮 Windows Desktop 改进，不自动授权 Mobile、Web、托管 Sync、企业
功能或公开发布。公开发布仍必须独立完成历史秘密扫描、正式签名/发布证据、隐私文档
和完整发布检查。
