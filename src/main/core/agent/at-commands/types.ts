/**
 * @命令类型定义（re-export shim）
 *
 * v0.9 起，所有 @命令类型已迁移到三端共享文件 `src/shared/at-command-types.ts`，
 * 让 main / preload / renderer 都能从 `@shared/at-command-types` 直接导入。
 *
 * 本文件保留 re-export 以兼容历史导入路径（`./types`）。
 * 新代码请直接从 `@shared/at-command-types` 导入。
 *
 * 方案书依据：v0.9 §4.1（8 类 @命令）+ §4.3（@命令接口契约）
 */
export * from '@shared/at-command-types'
