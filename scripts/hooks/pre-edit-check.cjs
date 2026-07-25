#!/usr/bin/env node
/**
 * PreEdit Hook: 防止误删关键文件
 *
 * 依据：方案书 §3.3
 * 触发：Claude Code 调用 Edit/Write 工具前
 * 输入：stdin 接收 JSON，含 tool_input.file_path
 * 输出：
 *   - exit 0：放行
 *   - exit 2：阻止操作（stderr 输出原因）
 *
 * 受保护文件清单（依据方案书 §3.3）：
 *   - credibility/ 目录（D-S 证据理论 / PCR5 / fusion-engine）
 *   - preload/index.ts + index.d.ts（IPC 暴露层，误删会破坏渲染层所有调用）
 *   - main/ipc/index.ts（IPC handler 注册中心）
 */
const fs = require('fs');
const path = require('path');

const PROTECTED_FILES = [
  'src/main/core/agent/credibility/calibration/',
  'src/main/core/agent/credibility/ds-theory.ts',
  'src/main/core/agent/credibility/pcr5.ts',
  'src/main/core/agent/credibility/fusion-engine.ts',
  'src/preload/index.ts',
  'src/preload/index.d.ts',
  'src/main/ipc/index.ts',
];

// 读取 stdin（Claude Code 传入的工具调用信息）
let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const filePath = data.tool_input?.file_path || '';

    for (const protected_ of PROTECTED_FILES) {
      if (filePath.includes(protected_)) {
        console.error(`⚠️  受保护文件：${filePath}`);
        console.error(`    修改前请确认：`);
        console.error(`    1. 是否在 PR 中说明理由`);
        console.error(`    2. 是否已 git status 确认工作区干净`);
        console.error(`    3. 是否已 grep 引用确认影响范围`);
        process.exit(2); // 阻止操作
      }
    }

    process.exit(0);
  } catch (e) {
    // 解析失败时放行（避免阻塞正常工作流）
    process.exit(0);
  }
});
