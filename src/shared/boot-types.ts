/**
 * boot-types.ts —— 启动加载阶段的跨进程载荷（单一来源）
 *
 * 治的病：这个载荷的形状原先手抄在三处（主进程 ipc/boot.ts、preload/index.ts、
 * 渲染层 BootPage.tsx），而跨进程的 TypeScript 不做端到端校验，抄漏一个字段
 * 不会报错，只会在运行时变成 undefined。2026-10-17 加载页去掉进度条后，
 * 载荷里的 progress 已经没人读，也还留在三份抄件里。
 *
 * 现在以这里为准：主进程构造它、preload 转发它、渲染层从契约生成的签名推断它。
 */

/** 加载阶段标识 */
export type BootStage = 'ipc-ready' | 'sqlite-init' | 'kb-indexed' | 'done'

/**
 * boot:loading-stage 推送的载荷（主 → 渲染），也是 boot:get-state 的返回值
 *
 * 没有 progress：界面不再画进度条，就绪与否只看 stage，百分比是 stage 的派生物，
 * 留着一个没人读的字段等于给下一轮"只写不读"开门。
 */
export interface BootLoadingStage {
  stage: BootStage
  message: string
}
