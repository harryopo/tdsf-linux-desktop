# 前端工作总结 — v4.0 UI 架构重构

> 日期：2026-07-25
> 分支：`feat/design-migration`
> 设计基准：`tdsf-linux-redesign/pages/workbench-ai.html`
> 构建状态：`pnpm build` ✅ 通过（23.50s）

---

## 一、问题诊断与根因分析

本次工作起因于用户反馈三个核心问题：

1. **侧边栏不持久**：ActivityRail 仅在 WorkbenchPage 内部渲染，切换到决策页、监控页等路由后侧边栏消失。根因是架构设计缺陷——导航组件被放在了页面级而非布局级。

2. **可信度决策页面缺失**：ActivityRail 中 decision 的路由映射错误指向 `/history`，导致点击决策图标实际跳转到历史记录页。

3. **AI Panel 视觉粗糙**：showDemo 默认为 true 导致首次进入直接显示 mock 数据而非欢迎态；header 高度 40px 与设计稿 32px 不符；多处 CSS 属性（背景色、间距、圆角）与设计稿存在偏差。

深层根因：之前的工作侧重于功能实现和死代码清理，缺乏以设计稿为基准的逐像素视觉校准流程。

---

## 二、修复内容清单

### 2.1 架构级修复（结构性）

**MainLayout v4.0 — ActivityRail 持久化**

将 ActivityRail 从 WorkbenchPage 内部提升至 MainLayout 布局层。新架构：

```
MainLayout (flex row)
├── ActivityRail (48px, 全局持久)
└── <Outlet /> (flex:1, 路由内容区)
```

路由映射通过 `useLocation` + `deriveActiveNav()` 自动推导激活态，无需页面组件传参。

涉及文件：
- `src/renderer/src/components/layout/MainLayout.tsx` — 完全重写
- `src/renderer/src/components/layout/MainLayout.css` — 添加 flex 布局
- `src/renderer/src/pages/WorkbenchPage.tsx` — 移除内部 ActivityRail（-23 行）
- `src/renderer/src/components/workbench/ActivityRail.tsx` — 修复 decision 路由

### 2.2 AI Panel 精细化

- `AIPanel.tsx`：showDemo 默认 false，首次进入展示欢迎态
- `AIPanelHeader.tsx`：高度 40px → 32px，padding 16px → 12px
- `MessageList.tsx`：新增"查看诊断示例"按钮，允许用户一键查看 rich panel 演示

### 2.3 CSS 视觉对齐（7 项修复）

| 组件 | 属性 | 修复前 → 修复后 |
|------|------|----------------|
| ActivityRail | background | bg-base-default → bg-base-secondary |
| ActivityRail | gap | 4px → 8px |
| ActivityRail | border-radius | 4px → 8px |
| FileTree header | height | 28px → 32px |
| FileTree header | letter-spacing | 0.05em → 0.08em |
| Titlebar | padding | 12px → 8px |
| Composer | focus box-shadow | 2px → 3px inset |

---

## 三、验证方式

采用代码级 CSS 属性逐项对比法，以 `tdsf-linux-redesign/pages/workbench-ai.html` 为设计基准，对每个模块的每个视觉属性进行精确比对。完整报告见 `docs/FRONTEND-VISUAL-COMPARISON.md`。

已验证对齐模块：ActivityRail、WorkbenchTitlebar、FileTree、AI Panel Header、Composer、StatusBar、决策页、监控页。

交互验证：侧边栏全局持久 ✅、路由跳转 ✅、决策页渲染 ✅、欢迎态展示 ✅、页面切换动画 ✅。

---

## 四、遗留问题与后续建议

### 4.1 短期（比赛前 7/30 前建议完成）

- 快捷 chips 绑定 `send(chip)` 实现点击即发送
- "查看诊断示例"按钮端到端手动验证
- 决策页补充真实数据接入（当前为空状态）

### 4.2 中期（架构优化）

- LiveMessageRow 扩展：解析 agent 返回的 tool_use 块，渲染 rich panel（thought/skill/command/metric 等）
- ToolPanel 组件从 mock-only 升级为支持 live 数据源
- AgentMessage 类型扩展：增加 `blocks: ToolBlock[]` 字段

### 4.3 长期（功能完善）

- P0 功能接入：v2.5 异步 backfill、PAOR 启动入口、CalibrationSettings
- ElectronAPI 类型声明补齐（~25 个方法）
- 清理 mock-data 残留

---

## 五、经验教训

1. **设计稿对齐必须是像素级的**：不能只看"功能能用"，要逐属性对比 CSS 值。
2. **架构问题优先于样式问题**：侧边栏不持久是架构缺陷，不是 CSS 能修的。
3. **验证要端到端**：启动设计稿 HTTP 服务 + 应用 dev 服务，逐模块截图对比。
4. **先结构后细节**：先修路由/布局架构，再调 CSS 属性，最后打磨交互。

---

## 六、变更文件汇总

```
src/renderer/src/components/layout/MainLayout.tsx      (重写)
src/renderer/src/components/layout/MainLayout.css      (修改)
src/renderer/src/components/workbench/ActivityRail.tsx  (修改)
src/renderer/src/components/workbench/AIPanel.tsx       (修改)
src/renderer/src/components/workbench/AIPanelHeader.tsx (修改)
src/renderer/src/components/workbench/MessageList.tsx   (修改)
src/renderer/src/components/workbench/Workbench.css     (修改)
src/renderer/src/pages/WorkbenchPage.tsx                (修改)
docs/FRONTEND-VISUAL-COMPARISON.md                      (新增)
docs/handoff/HANDOVER.md                                (更新)
docs/handoff/FRONTEND-WORK-SUMMARY-v4.0.md             (新增，本文档)
```
