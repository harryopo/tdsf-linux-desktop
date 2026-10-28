/**
 * 监控页"这份数据还活着吗"的判据（#257）
 *
 * 背景：远端断链后，采集定时器还在跑、`tick` 里的失败被 `catch(() => {})` 吞掉，
 * 渲染层唯一能知道的信号是 `ssh:state-changed`——而监控页此前不读它。
 * 于是页面继续把最后一帧当现在：横幅写"系统运行正常"，KPI 是十分钟前的数。
 *
 * 这里只钉住**结论怎么算**（纯函数）；文案与真实 DOM 由
 * tests/e2e/monitor-stale-state.spec.ts 在真窗口里验。
 */
import { describe, it, expect } from 'vitest'
import { deriveMonitorFreshness } from '../../src/renderer/src/components/monitor/monitor-model'

const STALE = 15_000

describe('deriveMonitorFreshness', () => {
  it('没有活跃会话时，即使库里有历史数据也不算"在采"', () => {
    expect(
      deriveMonitorFreshness({
        hasSession: false,
        connectionState: 'connected',
        lastSampleAt: 1_000,
        now: 1_000,
        staleAfterMs: STALE,
      })
    ).toBe('no-session')
  })

  it('正在重连：单独一档，不能混进"已断开"也不能报"正常"', () => {
    expect(
      deriveMonitorFreshness({
        hasSession: true,
        connectionState: 'connecting',
        lastSampleAt: 1_000,
        now: 1_000,
        staleAfterMs: STALE,
      })
    ).toBe('connecting')
  })

  it('error 与 disconnected 都算断开', () => {
    for (const state of ['error', 'disconnected'] as const) {
      expect(
        deriveMonitorFreshness({
          hasSession: true,
          connectionState: state,
          lastSampleAt: 1_000,
          now: 1_000,
          staleAfterMs: STALE,
        })
      ).toBe('disconnected')
    }
  })

  it('连接还在但一条采样都没有：等待首采，不是"正常"', () => {
    expect(
      deriveMonitorFreshness({
        hasSession: true,
        connectionState: 'connected',
        lastSampleAt: null,
        now: 1_000,
        staleAfterMs: STALE,
      })
    ).toBe('waiting')
  })

  it('连接还在、采样是新的：live', () => {
    expect(
      deriveMonitorFreshness({
        hasSession: true,
        connectionState: 'connected',
        lastSampleAt: 1_000,
        now: 1_000 + STALE,
        staleAfterMs: STALE,
      })
    ).toBe('live')
  })

  it('刚好卡在阈值上还算 live，过 1 毫秒就 stale（边界只许有一个答案）', () => {
    expect(
      deriveMonitorFreshness({
        hasSession: true,
        connectionState: 'connected',
        lastSampleAt: 1_000,
        now: 1_000 + STALE,
        staleAfterMs: STALE,
      })
    ).toBe('live')
    expect(
      deriveMonitorFreshness({
        hasSession: true,
        connectionState: 'connected',
        lastSampleAt: 1_000,
        now: 1_000 + STALE + 1,
        staleAfterMs: STALE,
      })
    ).toBe('stalled')
  })

  it('连接状态未知时按数据说话：新数据算 live，旧数据算 stalled', () => {
    expect(
      deriveMonitorFreshness({
        hasSession: true,
        connectionState: undefined,
        lastSampleAt: 1_000,
        now: 1_200,
        staleAfterMs: STALE,
      })
    ).toBe('live')
    expect(
      deriveMonitorFreshness({
        hasSession: true,
        connectionState: undefined,
        lastSampleAt: 1_000,
        now: 1_000 + STALE * 10,
        staleAfterMs: STALE,
      })
    ).toBe('stalled')
  })

  it('采样时间戳比现在还晚（时钟回拨/跨机误差）不许判成过期', () => {
    expect(
      deriveMonitorFreshness({
        hasSession: true,
        connectionState: 'connected',
        lastSampleAt: 10_000,
        now: 9_000,
        staleAfterMs: STALE,
      })
    ).toBe('live')
  })
})
