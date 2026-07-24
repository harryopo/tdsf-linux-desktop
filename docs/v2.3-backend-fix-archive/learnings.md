# v2.3 后端修复完善经验教训

**日期**：2026-07-24

## LRN-20260724-001：Electron 国内镜像应使用 `.npmrc` 而非 `npm config set`

- **现象**：`pnpm build:win` 时 electron-builder 下载 Electron 失败，尝试 `npm config set electron_mirror` 报错 `not a valid npm option`。
- **根因**：npm 10+ 不再将 `electron_mirror` / `electron_builder_binaries_mirror` 视为合法配置项。
- **方案**：在项目根目录创建 `.npmrc`，写入：
  ```ini
  registry=https://registry.npmmirror.com
  electron_mirror=https://npmmirror.com/mirrors/electron/
  electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/
  ```
- **结论**：Electron 国内构建失败优先用 `.npmrc`，不要依赖全局 npm config。

## LRN-20260724-002：Vitest 组件测试必须显式声明 `@/` 别名

- **现象**：`BootPage.test.tsx` 无法解析 `@/utils/electron-api`。
- **根因**：`vitest.config.ts` 只声明了 `@main` / `@shared` / `@renderer`，未声明 `@`。
- **方案**：在 `resolve.alias` 中补充 `@: resolve(__dirname, 'src/renderer/src')`。
- **结论**：即使 `tsconfig.web.json` 已配置 `@/`，Vitest 仍需独立配置别名。

## LRN-20260724-003：进度条可访问性属性缺一不可

- **现象**：RTL `screen.getByRole('progressbar')` 找不到 BootPage 进度条。
- **根因**：仅使用语义化 div 不够，需要显式 `role="progressbar"` + `aria-valuenow` / `aria-valuemin` / `aria-valuemax` / `aria-label`。
- **方案**：在 `BootPage.tsx` 中补齐所有属性，并增加可见状态文本。
- **结论**：自定义进度条必须手动暴露 ARIA 属性，否则测试与读屏均无法识别。

## LRN-20260724-004：项目重塑后及时清理过期测试

- **现象**：calibration 相关模块已在救赎之路方案中删除，但对应测试仍残留，导致测试套件找不到模块。
- **方案**：删除 `tests/core/agent/credibility/calibration-tuner.test.ts`、`ece.test.ts`、`temperature-scaling.test.ts` 与 `tests/components/ai/CalibrationPanel.test.tsx`。
- **结论**：删除功能模块时同步删除其测试，避免"模块已死、测试还魂"。
