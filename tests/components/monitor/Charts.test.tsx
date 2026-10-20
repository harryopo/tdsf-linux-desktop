/**
 * tests/components/monitor/Charts.test.tsx
 * recharts 图表在 React 19 + recharts 3 下的真渲染测试（阶段 B）
 *
 * 为什么必须有：监控页在无 SSH 会话时四个图表都走 EmptyMonitorState 占位，
 * 真机跑不到 recharts 的绘图分支 —— 而 recharts 2→3 恰恰是本轮唯一的大版本跳。
 * 这里灌入监控数据，让 AreaChart/LineChart/BarChart 真的画出来。
 *
 * 同时钉住升级引入的那个崩溃：无数据时选择器返回稳定空数组，
 * 有数据时正常出图，两种情况下都不许触发 "Maximum update depth exceeded"。
 *
 * 两处测试脚手架（都不进产品代码）：
 * - MemoryRouter：EmptyMonitorState 无条件调 useNavigate()，没有 Router 会抛
 * - 本地 ResizeObserver：全局 polyfill 的 observe() 是空实现，
 *   ResponsiveContainer 拿不到尺寸就不渲染任何 svg，等于什么都没测
 */
// @vitest-environment jsdom
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import {
  CpuAreaChart,
  DiskUsageBarChart,
  MemoryLineChart,
  NetworkFlowChart,
} from "@renderer/components/monitor/Charts";
import { useMonitorStore } from "@renderer/stores/monitor-store";
import { useServerStore } from "@renderer/stores/server-store";
import type { MonitorData } from "@shared/models";

/** 容器上报的假尺寸（与 Charts.tsx 的 CHART_H 对齐） */
const BOX = { width: 600, height: 140 };

beforeAll(() => {
  globalThis.ResizeObserver = class {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element): void {
      const rect = { ...BOX, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0 };
      this.callback(
        [
          { contentRect: rect, target, borderBoxSize: [], contentBoxSize: [] },
        ] as unknown as ResizeObserverEntry[],
        this as unknown as ResizeObserver,
      );
    }
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
});

/** 造 n 条时间递增的监控数据（字段严格对齐 @shared/models 的 MonitorData） */
function makeSeries(count: number): MonitorData[] {
  const base = Date.now() - count * 1000;
  return Array.from({ length: count }, (_, i) => ({
    timestamp: base + i * 1000,
    cpuUsage: 10 + i,
    memoryUsage: 20 + i,
    diskUsage: 30 + i,
    networkIn: 1024 * (i + 1),
    networkOut: 2048 * (i + 1),
    loadAverage: 0.5 + i / 10,
    uptime: 3600 + i,
    processCount: 100 + i,
  }));
}

/** 包一层 Router 再渲染 */
function renderChart(node: React.ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

/** 本用例集唯一的数据源：喂给图表的那一份，断言也用同一份（不许再造第二次） */
let series: MonitorData[] = [];

/**
 * 时钟钉在"每分钟第 5 秒"。
 *
 * 为什么钉在这里：makeSeries 的采样点是 `Date.now()-8s … -1s`（全在过去）。钉到第 5 秒，
 * 这 8 个点就落在上一分钟的 :57/:58/:59 与本分钟的 :00…:04 上——**数据必定跨一分钟**。
 * 原先不钉钟：beforeEach 造一次数据、断言里又 makeSeries(8) 造第二次，两遍各看各的 Date.now()；
 * 只要这两步之间跨过一分钟，断言就报"刻度 01:21 不在数据时间里"——CI 上随机红，
 * 一天推几次 × 三个平台，失败邮件全灌进仓库所有者邮箱（2026-10-20 实测 12 小时内 18 次红）。
 * 同族的另一条是视觉基线量到调度器"下次执行"日期、跨午夜必红。
 * 只 fake Date：recharts 的挂载不依赖定时器，faking 全套会顺手改坏渲染时序。
 */
const MINUTE_STRADDLE = 5;

beforeEach(() => {
  const now = new Date();
  now.setSeconds(MINUTE_STRADDLE, 0);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);

  const monitor = useMonitorStore.getState();
  monitor.clearAllMonitorData();
  // 图表按 activeSessionId 取数，先把它钉成一个有数据的会话
  useServerStore.setState({ activeSessionId: "sess-chart" });
  series = makeSeries(8);
  series.forEach((d) => monitor.addMonitorData("sess-chart", d));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("recharts 3 真渲染", () => {
  it("1. CPU 面积图画出 svg 与面积路径，不再退回空状态", () => {
    const { container } = renderChart(<CpuAreaChart />);
    expect(screen.queryByText(/暂无CPU监控数据/)).toBeNull();
    expect(container.querySelector(".recharts-surface")).not.toBeNull();
    expect(container.querySelector(".recharts-area-area")).not.toBeNull();
  });

  it("2. 内存折线图画出折线", () => {
    const { container } = renderChart(<MemoryLineChart />);
    expect(container.querySelector(".recharts-surface")).not.toBeNull();
    expect(container.querySelector(".recharts-line-curve")).not.toBeNull();
  });

  it("3. 磁盘 IO 柱状图画出柱子", () => {
    const { container } = renderChart(<DiskUsageBarChart />);
    expect(container.querySelector(".recharts-surface")).not.toBeNull();
    expect(container.querySelector(".recharts-bar-rectangle")).not.toBeNull();
  });

  it("4. 网络流量图画出折线", () => {
    const { container } = renderChart(<NetworkFlowChart />);
    expect(container.querySelector(".recharts-surface")).not.toBeNull();
    expect(container.querySelector(".recharts-line-curve")).not.toBeNull();
  });

  it("5. 无数据会话下渲染不触发无限重渲染（React 19 + zustand 5 回归）", () => {
    useServerStore.setState({ activeSessionId: "sess-empty" });
    // Maximum update depth exceeded 会以抛错形式冒出来，render 不抛即为通过
    expect(() => renderChart(<CpuAreaChart />)).not.toThrow();
    expect(screen.getByText(/暂无CPU监控数据/)).toBeInTheDocument();
  });

  it("6. x 轴刻度只能来自真实采样点（写死的 00:00/06:00/12:00 时间轴已删）", () => {
    const { container } = renderChart(<CpuAreaChart />);
    const ticks = [...container.querySelectorAll(".mon-chart-axis span")]
      .map((el) => el.textContent)
      .filter((t): t is string => Boolean(t));
    expect(ticks.length).toBeGreaterThan(0);

    // 断言用的就是喂给图表的那一份数据——原先这里又 makeSeries(8) 造了第二份，
    // 两遍各看一次钟，跨分钟就自己和自己对不上
    const hhmm = (ts: number) => {
      const t = new Date(ts);
      return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
    };
    const real = new Set(series.map((d) => hhmm(d.timestamp)));

    // 阳性对照：这一批数据确实跨了一分钟（钉在第 5 秒的意义就在这），
    // 否则这条用例退化成"同一分钟内部自洽"，测不到它真正要防的那个错
    expect(
      real.size,
      "夹具应当跨两个分钟位，否则这条判据是空的",
    ).toBeGreaterThanOrEqual(2);
    expect(
      Math.max(...series.map((d) => d.timestamp)) -
        Math.min(...series.map((d) => d.timestamp)),
    ).toBeGreaterThanOrEqual(6_000);

    for (const tick of ticks)
      expect(real.has(tick), `刻度 ${tick} 不在数据时间里`).toBe(true);
  });

  it("7. 无数据时不渲染时间轴（不给空图配一条假刻度）", () => {
    useServerStore.setState({ activeSessionId: "sess-empty" });
    const { container } = renderChart(<CpuAreaChart />);
    expect(container.querySelector(".mon-chart-axis")).toBeNull();
  });
});
