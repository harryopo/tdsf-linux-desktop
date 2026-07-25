# Security Policy

## 支持的版本

| 版本  | 支持状态              |
| ----- | --------------------- |
| 1.0.x | ✅ 活跃支持（v1.0.0+）|
| < 1.0 | ❌ 不再支持           |

## 报告漏洞

**请勿在公开 Issue 中报告安全漏洞。**

请通过以下方式私下报告：

- **Email**: harryopo (at) example.com
- **主题前缀**: `[SECURITY] `
- **PGP 公钥**: 待提供

我们承诺：

- **48 小时内**确认收到
- **7 天内**给出初步评估
- 修复后会公开致谢（除非你要求匿名）

## 安全更新流程

1. 内部评估严重程度（Critical / High / Medium / Low）
2. 准备修复补丁 + Release Notes
3. 发布安全版本 + GitHub Security Advisory
4. 通知所有已知用户

## 安全最佳实践（用户侧）

- ✅ 始终使用最新版（设置 → 关于 → 检查更新）
- ✅ SSH 私钥使用 ED25519 或 RSA-4096
- ✅ 启用三态权限审批（ALWAYS / AUTO / NEVER）
- ✅ 不要在公共 WiFi 下管理生产服务器
- ✅ 定期审查 AI 自动执行的命令日志

## 安全特性（本项目）

- **contextIsolation: true** — 渲染进程与 Node.js 隔离
- **nodeIntegration: false** — 渲染进程无 Node.js 权限
- **sandbox: true** — Chromium 沙箱启用
- **CSP 严格策略** — 阻止 XSS / 注入
- **IPC 参数校验** — 防止恶意输入
- **不收集遥测数据** — 100% 本地化（除 AI Provider API 调用）

## 已知安全问题

暂无。

## 致谢

感谢以下安全研究人员的贡献（按时间顺序）：

- 待添加
