# JoeSSH UI 生产接入验收

日期：2026-07-29

## 结论

最终 UI 已接入 Desktop、Web Admin 与 Mobile 的真实生产入口。ImageGen 母版只保留为视觉方向参考，运行时界面由共享 token、平台组件、业务状态和真实服务调用生成，不依赖切图或静态效果稿。

## 生产入口

- Desktop：`apps/desktop/index.html` → `apps/desktop/src/main.tsx` → 共享 UI 样式、Desktop 功能样式与最终工作台主题；Tauri `frontendDist` 指向构建后的 `dist`。
- Web Admin：`apps/web/index.html` → `apps/web/src/main.tsx` → Web Admin 主题；默认读取同源 `/api/admin/snapshot`，演示快照只能通过显式查询参数启用。
- Mobile：`expo-router/entry` → `apps/mobile/app/_layout.tsx` → `apps/mobile/app/index.tsx`；真实执行设备注册、presence push、增量 pull、离线回退与错误分类。

## 本轮接入修复

- Desktop 分组管理的重命名、确认、取消和删除图标按钮接入共享按钮组件样式。
- Desktop 自定义连接的分组覆盖可跨刷新持久化，删除连接时同步清理陈旧覆盖。
- Desktop 自定义连接与快速连接加入动态排序状态，支持拖拽和键盘排序，并在连接增删后保持合法顺序。
- Mobile 新增根级共享 locale provider；主页与 Router 致命错误边界现在共用语言、翻译器和页面语言状态，切换语言后不会出现错误页仍使用旧语言的问题。

## 真实程序抽检

- Desktop 生产 `dist`：Light/Dark 切换生效，中文工作台、终端、上下文、SFTP、团队、端口转发和设置入口均在真实 DOM 中；页面无文档级横向溢出。
- Web Admin 生产 `dist`：同步、设备、团队、审计和存储导航均存在；Light 主题实机抽检通过，真实刷新会重新请求快照；页面无文档级横向溢出。
- Mobile Expo Web 生产导出：中文界面与 Arabic RTL 均来自实际程序；语言切换同步更新 `html lang`，RTL 文本和物理强调边正确，页面无文档级横向溢出。

## 自动化门禁

- ESLint：通过。
- 全仓 TypeScript：通过。
- 全仓单元测试：71 个测试文件、1013 项测试全部通过。
- 完整 fresh-port E2E：85 项中 84 项通过、1 项按项目配置跳过、0 项失败。
- Desktop 生产构建：通过，包含共享样式、最终主题、SRI 与按需功能块。
- Web Admin 生产构建：通过，包含哈希资源、SRI 与 Service Worker。
- Mobile Expo Web 生产导出：通过，798 个模块。
- Tauri `cargo check --locked`：通过，0 warning、0 error。
- Desktop/Web SRI、安全响应头和启动包体积门禁：全部通过；gzip 启动包分别为 212.91KB 与 192.86KB，均低于 250KB 预算。

## 发布边界

- Web 部署必须由现有代理提供同源 `/api/admin/snapshot`。
- Mobile 原生发布仍需对齐 React Native 依赖栈，并在 Android/iOS 真机上完成 Hermes、Safe Area、字体缩放和屏幕阅读器验收。
- 当前工作区缺少完整 `.git` 元数据，发布前必须在健康 clone 中复核并提交本轮变更。
