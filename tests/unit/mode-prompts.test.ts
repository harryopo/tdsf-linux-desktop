/**
 * Mode Prompt 单元测试（v0.9.4 批次 3 - 任务 5+6）
 *
 * 覆盖 plan-prompt.ts 和 ask-prompt.ts 的核心逻辑：
 * - PLAN_MODE_SYSTEM_PROMPT 包含 5 个段落（身份/约束/输出格式/步骤示例/结尾要求）
 * - buildPlanPrompt 拼接 systemPrompt + userRequest
 * - ASK_MODE_SYSTEM_PROMPT 包含 5 个段落（身份/约束/信息收集流程/引用格式/不确定处理）
 * - buildAskPrompt 拼接 systemPrompt + userRequest
 *
 * 设计依据：v0.9.4 §11 第 5 类（Mode 五模式）
 */
import { describe, it, expect } from 'vitest'
import {
  PLAN_MODE_SYSTEM_PROMPT,
  buildPlanPrompt,
} from '../../src/main/core/agent/modes/plan-prompt'
import {
  ASK_MODE_SYSTEM_PROMPT,
  buildAskPrompt,
} from '../../src/main/core/agent/modes/ask-prompt'

// ============================================================================
// Plan 模式 prompt 测试
// ============================================================================

describe('[plan-prompt] PLAN_MODE_SYSTEM_PROMPT', () => {
  it('prompt 非空且较长', () => {
    expect(PLAN_MODE_SYSTEM_PROMPT.length).toBeGreaterThan(500)
  })

  it('包含"计划模式"标题', () => {
    expect(PLAN_MODE_SYSTEM_PROMPT).toContain('计划模式')
  })

  it('包含"身份"段落', () => {
    expect(PLAN_MODE_SYSTEM_PROMPT).toContain('身份')
  })

  it('包含"约束"段落：明确禁止执行修改操作', () => {
    expect(PLAN_MODE_SYSTEM_PROMPT).toContain('约束')
    expect(PLAN_MODE_SYSTEM_PROMPT).toContain('严禁')
  })

  it('包含"输出格式"段落：步骤清单', () => {
    expect(PLAN_MODE_SYSTEM_PROMPT).toContain('输出格式')
    expect(PLAN_MODE_SYSTEM_PROMPT).toContain('步骤')
  })

  it('包含"步骤示例"段落', () => {
    expect(PLAN_MODE_SYSTEM_PROMPT).toContain('步骤示例')
  })

  it('包含"等待确认"结尾要求', () => {
    expect(PLAN_MODE_SYSTEM_PROMPT).toContain('等待确认')
    expect(PLAN_MODE_SYSTEM_PROMPT).toContain('code 模式')
  })

  it('强调"不执行"', () => {
    expect(PLAN_MODE_SYSTEM_PROMPT).toMatch(/不执行|不直接执行/)
  })
})

describe('[plan-prompt] buildPlanPrompt', () => {
  it('包含 systemPrompt 全文', () => {
    const userRequest = '重启 nginx 服务'
    const prompt = buildPlanPrompt(userRequest)
    expect(prompt).toContain(PLAN_MODE_SYSTEM_PROMPT)
  })

  it('包含用户请求', () => {
    const userRequest = '部署新的 systemd 服务 unit'
    const prompt = buildPlanPrompt(userRequest)
    expect(prompt).toContain(userRequest)
  })

  it('用户请求位于 systemPrompt 之后', () => {
    const userRequest = 'TEST_USER_REQUEST_MARKER'
    const prompt = buildPlanPrompt(userRequest)
    const sysIdx = prompt.indexOf(PLAN_MODE_SYSTEM_PROMPT)
    const reqIdx = prompt.indexOf(userRequest)
    expect(sysIdx).toBeGreaterThanOrEqual(0)
    expect(reqIdx).toBeGreaterThan(sysIdx)
  })

  it('空用户请求也能构建（不抛错）', () => {
    expect(() => buildPlanPrompt('')).not.toThrow()
  })
})

// ============================================================================
// Ask 模式 prompt 测试
// ============================================================================

describe('[ask-prompt] ASK_MODE_SYSTEM_PROMPT', () => {
  it('prompt 非空且较长', () => {
    expect(ASK_MODE_SYSTEM_PROMPT.length).toBeGreaterThan(500)
  })

  it('包含"询问模式"标题', () => {
    expect(ASK_MODE_SYSTEM_PROMPT).toContain('询问模式')
  })

  it('包含"身份"段落', () => {
    expect(ASK_MODE_SYSTEM_PROMPT).toContain('身份')
  })

  it('包含"约束"段落：明确禁止修改', () => {
    expect(ASK_MODE_SYSTEM_PROMPT).toContain('约束')
    expect(ASK_MODE_SYSTEM_PROMPT).toContain('只读')
    expect(ASK_MODE_SYSTEM_PROMPT).toContain('严禁')
  })

  it('包含"信息收集流程"段落', () => {
    expect(ASK_MODE_SYSTEM_PROMPT).toContain('信息收集流程')
  })

  it('包含"引用格式"段落', () => {
    expect(ASK_MODE_SYSTEM_PROMPT).toContain('引用格式')
    expect(ASK_MODE_SYSTEM_PROMPT).toContain('[KB:')
    expect(ASK_MODE_SYSTEM_PROMPT).toContain('[LOG:')
  })

  it('包含"不确定时处理"段落：明确说"我不知道"', () => {
    expect(ASK_MODE_SYSTEM_PROMPT).toContain('不确定')
    expect(ASK_MODE_SYSTEM_PROMPT).toContain('我不知道')
  })

  it('强调"基于证据"', () => {
    expect(ASK_MODE_SYSTEM_PROMPT).toMatch(/基于证据|基于工具收集/)
  })
})

describe('[ask-prompt] buildAskPrompt', () => {
  it('包含 systemPrompt 全文', () => {
    const userRequest = 'nginx 为什么启动失败'
    const prompt = buildAskPrompt(userRequest)
    expect(prompt).toContain(ASK_MODE_SYSTEM_PROMPT)
  })

  it('包含用户请求', () => {
    const userRequest = '当前系统负载情况如何'
    const prompt = buildAskPrompt(userRequest)
    expect(prompt).toContain(userRequest)
  })

  it('用户请求位于 systemPrompt 之后', () => {
    const userRequest = 'TEST_ASK_MARKER'
    const prompt = buildAskPrompt(userRequest)
    const sysIdx = prompt.indexOf(ASK_MODE_SYSTEM_PROMPT)
    const reqIdx = prompt.indexOf(userRequest)
    expect(sysIdx).toBeGreaterThanOrEqual(0)
    expect(reqIdx).toBeGreaterThan(sysIdx)
  })

  it('空用户请求也能构建（不抛错）', () => {
    expect(() => buildAskPrompt('')).not.toThrow()
  })
})

// ============================================================================
// 两个 prompt 的差异化测试
// ============================================================================

describe('[mode-prompts] plan vs ask 差异化', () => {
  it('两个 prompt 不相同', () => {
    expect(PLAN_MODE_SYSTEM_PROMPT).not.toBe(ASK_MODE_SYSTEM_PROMPT)
  })

  it('plan prompt 关注"方案"，ask prompt 关注"证据"', () => {
    expect(PLAN_MODE_SYSTEM_PROMPT).toContain('方案')
    expect(ASK_MODE_SYSTEM_PROMPT).toContain('证据')
  })

  it('plan prompt 包含"步骤清单"，ask prompt 包含"信息收集"', () => {
    expect(PLAN_MODE_SYSTEM_PROMPT).toContain('步骤')
    expect(ASK_MODE_SYSTEM_PROMPT).toContain('信息收集')
  })

  it('两个 buildXxxPrompt 输出不同', () => {
    const userRequest = 'test'
    expect(buildPlanPrompt(userRequest)).not.toBe(buildAskPrompt(userRequest))
  })
})
