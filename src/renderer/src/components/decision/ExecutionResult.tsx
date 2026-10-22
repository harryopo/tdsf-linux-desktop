/**
 * ExecutionResult — 命令决策终端 + 审计日志
 *
 * 设计稿：decision-detail.html 区域2 右侧（命令决策终端）+ 区域6（审计日志）
 *
 * 包含两部分：
 * 1. 命令决策终端：三色点 + 决策 ID + 已校验 tag（按真实证据传入）+ 命令块 + 影响范围/回滚 + 操作区
 * 2. 决策审计日志：表格（行号/时间戳/操作者/动作/SHA-256 摘要/结果），
 *    行由主进程 `history:audit` 从本机 decision_audit 表读出，校验结论也算在主进程（任务 #174）
 *
 * 交互（v2.6 已真实接线）：
 * - approval 模式：采纳执行/修改/拒绝回调（活跃工作流 loopConfirm）
 * - readonly 模式：状态徽章 + 重新在终端执行（onRerun 回调，页面侧走 sshRunAuthored 过风险闸）
 * - 复制命令：navigator.clipboard 真实写入
 */
import { useState } from "react";
import { toast } from "sonner";
import {
  Terminal,
  Check,
  X,
  Edit3,
  Copy,
  CheckCheck,
  Play,
  CheckCircle2,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type { DecisionAuditResult } from "@shared/models";

/**
 * 审计日志行（形状 = 库里 decision_audit 那一行，见 @shared/models 的 DecisionAuditRow）
 *
 * 任务 #174：以前这一叠行是渲染层打开详情时按卡片字段现编的，哈希也是对现编的行算的；
 * 那样只能算"时间线视图"，改库里的卡改不出来。现在这里只装库里读出来的那一份。
 */
export interface AuditRow {
  /** 链上行号（库里自增，只增不改） */
  seq: number;
  timestamp: string;
  operator: string;
  action: string;
  /** 完整 64 位十六进制摘要：展示取前 8 后 6，悬停给全串 */
  hash: string;
  /** 前驱摘要（第一行是创世块：由决策 ID 推出的那一串） */
  prevHash: string;
  result: DecisionAuditResult;
}

/**
 * 审计链的状态（由页面按 history:audit 的返回算出来，组件不自己判）
 * - ok：有行且主进程重算后对得上
 * - broken：有行但某一行与链不符（brokenAtSeq 给出行号）
 * - empty：库里没有这一条决策的任何审计行
 * - unavailable：读不到（IPC 不可用或库处于降级模式）
 */
export type AuditChainStatus = "ok" | "broken" | "empty" | "unavailable";

/** 命令分段（5 色高亮，与 EvidenceList 一致） */
export interface CmdSegment {
  type: "name" | "flag" | "path" | "val" | "sym" | "comment" | "text";
  text: string;
}

interface ExecutionResultProps {
  /** 决策 ID（如 DEC-087） */
  decisionId: string;
  /** 命令分段 */
  commandSegments: CmdSegment[];
  /** 命令注释 */
  commandComment?: string;
  /** 影响范围 */
  impact: string;
  /** 预计耗时（v2.6：可选，无真实数据时不展示，不再编造 ~120ms） */
  duration?: string;
  /** 回滚方案 */
  rollback: string;
  /** 是否已校验（v2.6：默认 false，由调用方按真实证据传入） */
  verified?: boolean;
  /** 注：审计日志已拆成满宽的 DecisionAuditLog（#174），这里只管命令终端 */
  /**
   * 模式（v2.6）：approval=活跃审批（采纳/修改/拒绝）；
   * readonly=历史回放（状态徽章 + 重新在终端执行）。默认 approval 保持兼容。
   */
  mode?: "approval" | "readonly";
  /** 只读态状态文案（如“已执行”） */
  statusLabel?: string;
  /** 重新执行中 */
  rerunning?: boolean;
  /** 是否可重新执行（需活跃 SSH 会话） */
  canRerun?: boolean;
  /** 重新在终端执行回调（readonly 模式） */
  onRerun?: () => void;
  /** 采纳执行回调 */
  onAccept?: () => void;
  /** 修改回调 */
  onModify?: () => void;
  /** 拒绝回调 */
  onReject?: () => void;
}

/** 命令分段色 */
const CMD_COLORS: Record<CmdSegment["type"], string> = {
  name: "text-(--accent-text)",
  flag: "text-ink",
  path: "text-ink",
  val: "text-ink",
  sym: "text-ink-mute",
  comment: "text-ink-mute",
  text: "text-ink",
};

/** 审计结果 tag 映射（档位与 @shared/models 的 DecisionAuditResult 一致，少一档就会在运行时读到 undefined） */
const RESULT_TAGS: Record<
  DecisionAuditResult,
  { text: string; className: string }
> = {
  completed: {
    text: "完成",
    className:
      "border-[var(--trae-status-success-default)] bg-[rgba(51,193,146,0.12)] text-(--status-success-text)",
  },
  passed: {
    text: "通过",
    className:
      "border-[var(--trae-status-success-default)] bg-[rgba(51,193,146,0.12)] text-(--status-success-text)",
  },
  waiting: {
    text: "等待",
    className:
      "border-[var(--trae-status-alert-default)] bg-[rgba(210,157,0,0.12)] text-[var(--trae-status-alert-default)]",
  },
  pending: {
    text: "待触发",
    className:
      "border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-overlay-l1)] text-ink-mute",
  },
  failed: {
    text: "失败",
    className:
      "border-[var(--trae-status-error-default)] bg-[rgba(246,90,90,0.12)] text-(--status-error-text)",
  },
  blocked: {
    text: "拦截",
    className:
      "border-[var(--trae-status-error-default)] bg-[rgba(246,90,90,0.12)] text-(--status-error-text)",
  },
};

/** 哈希展示：0x + 前 8 位 + … + 后 6 位（完整 64 位放 title，选中该行可复制） */
function displayHash(hex: string): string {
  if (hex.length <= 16) return hex;
  return `0x${hex.slice(0, 8)}…${hex.slice(-6)}`;
}

/** 徽章只说量到的事：0 行绝不显示"校验通过" */
const CHAIN_BADGE: Record<
  AuditChainStatus,
  {
    text: (n: number) => string;
    className: string;
    tone: "ok" | "bad" | "mute";
  }
> = {
  ok: {
    text: (n) => `链校验通过 · ${n} 行`,
    className:
      "border-[var(--trae-status-success-default)] bg-[rgba(51,193,146,0.12)] text-(--status-success-text)",
    tone: "ok",
  },
  broken: {
    text: (n) => `链校验未通过 · ${n} 行`,
    className:
      "border-[var(--trae-status-error-default)] bg-[rgba(246,90,90,0.12)] text-(--status-error-text)",
    tone: "bad",
  },
  empty: {
    text: () => "这条记录没有审计链",
    className:
      "border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] text-ink-dim",
    tone: "mute",
  },
  unavailable: {
    text: () => "审计链读不到",
    className:
      "border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l1)] text-ink-dim",
    tone: "mute",
  },
};

/** 审计链状态徽章（决策详情与历史详情共用一处措辞，别两边各写一份） */
export function AuditChainBadge({
  status,
  rowCount,
}: {
  status: AuditChainStatus;
  rowCount: number;
}) {
  const meta = CHAIN_BADGE[status];
  const Icon = status === "ok" ? ShieldCheck : ShieldAlert;
  return (
    <span
      className={`inline-flex h-5 items-center gap-1 rounded-[var(--trae-radius-4)] border px-2 text-micro font-medium ${meta.className}`}
      data-dom-id="audit-chain-badge"
      data-audit-status={status}
    >
      <Icon className="size-3" />
      {meta.text(rowCount)}
    </span>
  );
}

/**
 * 命令决策终端（审计日志见同文件的 DecisionAuditLog）
 */
export function ExecutionResult({
  decisionId,
  commandSegments,
  commandComment,
  impact,
  duration,
  rollback,
  verified = false,
  mode = "approval",
  statusLabel,
  rerunning = false,
  canRerun = true,
  onRerun,
  onAccept,
  onModify,
  onReject,
}: ExecutionResultProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    // 拼接命令分段为纯文本（与展示一致，注释分段以 # 前缀保留语义）
    const cmdText = commandSegments
      .map((seg, i) => {
        if (seg.type === "comment") return `# ${seg.text}`;
        return i > 0 ? ` ${seg.text}` : seg.text;
      })
      .join("")
      .trim();
    try {
      await navigator.clipboard.writeText(cmdText);
      toast.success("命令已复制到剪贴板");
    } catch {
      toast.error("复制失败，请手动选择文本");
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex min-w-0 flex-1 basis-[420px] flex-col gap-6">
      {/* ===== 命令决策终端 ===== */}
      <div className="flex flex-1 min-w-[340px] flex-col overflow-hidden rounded-[var(--trae-radius-10)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)]">
        {/* 终端头部 */}
        <div className="flex items-center gap-2 border-b border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)] px-4 py-2.5">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--trae-status-error-default)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--trae-status-alert-default)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--trae-status-success-default)]" />
          </div>
          <div className="flex items-center gap-1.5">
            <Terminal className="h-3 w-3 text-ink-dim" />
            <span className="font-mono text-micro text-ink-dim">
              决策命令 · {decisionId}
            </span>
          </div>
          {verified && (
            <span className="ml-auto inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border border-[var(--trae-status-success-default)] bg-[rgba(51,193,146,0.12)] px-2 text-micro font-medium text-(--status-success-text)">
              已校验
            </span>
          )}
        </div>

        {/* 终端主体 */}
        <div className="flex flex-1 flex-col gap-3 p-4">
          {/* 命令块 */}
          <div className="rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-code-block)] px-4 py-3 font-mono text-title leading-[1.8]">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-ink-mute">$</span>
              <span className="flex-1">
                {commandSegments.map((seg, i) => (
                  <span key={i} className={CMD_COLORS[seg.type]}>
                    {i > 0 && seg.type !== "comment" ? " " : ""}
                    {seg.text}
                  </span>
                ))}
              </span>
              <button
                type="button"
                data-dom-id="copy-cmd"
                onClick={handleCopy}
                className="shrink-0 rounded p-1 text-ink-mute transition-colors hover:bg-[var(--trae-bg-overlay-l2)] hover:text-ink"
                aria-label="复制命令"
              >
                {copied ? (
                  <CheckCheck className="h-3.5 w-3.5 text-(--status-success-text)" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            {commandComment && (
              <div className="mt-1 pl-4 text-sm text-ink-mute">
                # {commandComment}
              </div>
            )}
          </div>

          {/* 影响范围 / 预计耗时（有真实值才显示）/ 回滚方案 */}
          <div
            className={`grid gap-2 ${duration ? "grid-cols-3" : "grid-cols-2"}`}
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-micro uppercase tracking-[0.06em] text-ink-mute">
                影响范围
              </span>
              <span className="text-sm font-medium text-ink">{impact}</span>
            </div>
            {duration && (
              <div className="flex flex-col gap-0.5">
                <span className="text-micro uppercase tracking-[0.06em] text-ink-mute">
                  预计耗时
                </span>
                <span className="font-mono text-sm font-medium tabular-nums text-ink">
                  {duration}
                </span>
              </div>
            )}
            <div className="flex flex-col gap-0.5">
              <span className="text-micro uppercase tracking-[0.06em] text-ink-mute">
                回滚方案
              </span>
              <span className="font-mono text-sm font-medium text-ink">
                {rollback}
              </span>
            </div>
          </div>

          {/* 操作区：approval=审批三按钮；readonly=状态徽章 + 重新在终端执行（v2.6） */}
          {mode === "readonly" ? (
            <div className="mt-auto flex items-center gap-2">
              {statusLabel && (
                <span className="inline-flex h-7 items-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-status-success-default)] bg-[rgba(51,193,146,0.12)] px-3 text-sm font-medium text-(--status-success-text)">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {statusLabel}
                </span>
              )}
              <button
                type="button"
                data-dom-id="rerun-cmd"
                onClick={onRerun}
                disabled={rerunning || !canRerun}
                title={
                  canRerun
                    ? "把该命令重新发送到工作台终端执行（含前置预检）"
                    : "需先连接 SSH 服务器"
                }
                className="ml-auto inline-flex items-center justify-center gap-1.5 rounded-[var(--trae-radius-6)] bg-accent-solid px-4 py-1.5 text-sm font-medium text-[var(--trae-text-onbrand)] transition-colors hover:bg-[var(--trae-bg-brand-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {rerunning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                {rerunning ? "发送中…" : "重新在终端执行"}
              </button>
            </div>
          ) : (
            <div className="mt-auto flex gap-2">
              <button
                type="button"
                data-dom-id="accept-execute"
                onClick={onAccept}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[var(--trae-radius-6)] bg-accent-solid px-3 py-1.5 text-sm font-medium text-[var(--trae-text-onbrand)] transition-colors hover:bg-[var(--trae-bg-brand-hover)]"
              >
                <Check className="h-3.5 w-3.5" />
                采纳执行
              </button>
              <button
                type="button"
                data-dom-id="modify-cmd"
                onClick={onModify}
                className="inline-flex items-center justify-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l2)] px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-hover"
              >
                <Edit3 className="h-3.5 w-3.5" />
                修改
              </button>
              <button
                type="button"
                data-dom-id="reject-cmd"
                onClick={onReject}
                className="inline-flex items-center justify-center gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l2)] bg-[var(--trae-bg-overlay-l2)] px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-hover"
              >
                <X className="h-3.5 w-3.5" />
                拒绝
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 决策审计日志（任务 #174）
 *
 * 单独一张满宽的卡：上一版它跟在命令终端下面，被左边的置信度仪表挤到 600px 出头，
 * 六列表格在 1180 宽的窗口里把「动作」列压成 0px（中文一个字一行竖排，还盖住哈希列）。
 * 内容仍然一行不改——行、时间戳、SHA-256 都是主进程落库时写进 decision_audit 的那一份。
 */
export function DecisionAuditLog({
  rows,
  status,
  brokenAtSeq = null,
}: {
  rows: AuditRow[];
  status: AuditChainStatus;
  brokenAtSeq?: number | null;
}) {
  return (
    <div
      className="rounded-[var(--trae-radius-8)] border border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-secondary)] p-6"
      data-dom-id="audit-chain-section"
      data-audit-status={status}
    >
      {/* 标题栏 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-title font-semibold text-ink">
            决策审计日志
          </span>
          <AuditChainBadge status={status} rowCount={rows.length} />
        </div>
        <span className="text-micro text-ink-mute">
          行、时间戳与 SHA-256 都由主进程在落库时写入 · 本机 SQLite 表
          decision_audit
        </span>
      </div>

      {status === "broken" && (
        <p
          className="mb-3 flex items-start gap-1.5 rounded-[var(--trae-radius-6)] border border-[var(--trae-status-error-default)] bg-[rgba(246,90,90,0.08)] px-3 py-2 text-micro text-(--status-error-text)"
          data-dom-id="audit-broken-note"
        >
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            第 {brokenAtSeq}{" "}
            行与它存下的哈希对不上：这条链在写入之后被改过，或者中间被删掉了一行。
            下面照实列出库里现在的样子，断点之前的行仍可信，之后的都不该当证据用。
          </span>
        </p>
      )}

      {status === "empty" && (
        <p
          className="mb-1 flex items-start gap-1.5 text-micro text-ink-dim"
          data-dom-id="audit-empty-note"
        >
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-ink-mute" />
          <span>
            库里没有这条决策的审计行：它写于审计表（migration
            v3）启用之前，或那次落库时数据库处于降级模式。
            卡片本身照样能看，但"当时发生了什么"这一步没有可核对的留痕——重新执行一次决策就会留下链。
          </span>
        </p>
      )}

      {status === "unavailable" && (
        <p
          className="mb-1 flex items-start gap-1.5 text-micro text-ink-dim"
          data-dom-id="audit-unavailable-note"
        >
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-ink-mute" />
          <span>
            读不到审计链：IPC
            桥接不可用或数据库处于降级模式（见设置页的数据库状态）。
          </span>
        </p>
      )}

      {rows.length > 0 && (
        /*
         * 表格：固定列宽 + 动作列给下限，容器放不下就整张表横向滚。
         * 上一版让动作列吃 flex-1 且没有下限，1180 宽的窗口实测把它压成 0px，
         * 中文一个字一行竖着排、还盖住哈希列——列宽不能让容器说了算。
         */
        <div className="overflow-x-auto rounded-[var(--trae-radius-6)] border border-[var(--trae-border-neutral-l1)]">
          <div className="min-w-[660px]">
            {/* 表头 */}
            <div className="flex items-center gap-3 border-b border-[var(--trae-border-neutral-l1)] bg-[var(--trae-bg-base-tertiary)] px-4 py-2">
              <span className="font-mono text-micro font-medium text-ink-mute flex-[0_0_34px]">
                链
              </span>
              <span className="font-mono text-micro font-medium text-ink-mute flex-[0_0_132px]">
                时间戳
              </span>
              <span className="font-mono text-micro font-medium text-ink-mute flex-[0_0_92px]">
                操作者
              </span>
              <span className="font-mono text-micro font-medium text-ink-mute flex-1 min-w-[150px]">
                动作
              </span>
              <span className="font-mono text-micro font-medium text-ink-mute flex-[0_0_118px]">
                SHA-256
              </span>
              <span className="font-mono text-micro font-medium text-ink-mute flex-[0_0_52px] text-right">
                结果
              </span>
            </div>

            {/* 数据行 */}
            {rows.map((row, idx) => {
              const tag = RESULT_TAGS[row.result];
              const isLast = idx === rows.length - 1;
              const isPending = row.result === "pending";
              const isBroken = status === "broken" && row.seq === brokenAtSeq;
              return (
                <div
                  key={row.seq}
                  data-dom-id="audit-row"
                  data-audit-broken={isBroken ? "true" : undefined}
                  className={`audit-row flex items-center gap-3 px-4 py-2 transition-colors ${
                    isBroken
                      ? "bg-[rgba(246,90,90,0.10)]"
                      : "hover:bg-[var(--trae-bg-overlay-l1)]"
                  } ${!isLast ? "border-b border-[var(--trae-border-neutral-l1)]" : ""}`}
                >
                  <span
                    className={`font-mono text-micro tabular-nums flex-[0_0_34px] ${
                      isBroken ? "text-(--status-error-text)" : "text-ink-mute"
                    }`}
                    title={`第 ${row.seq} 行`}
                  >
                    #{row.seq}
                  </span>
                  <span
                    className={`font-mono text-micro tabular-nums flex-[0_0_132px] whitespace-nowrap ${
                      isPending ? "text-ink-mute" : "text-ink-dim"
                    }`}
                  >
                    {row.timestamp}
                  </span>
                  <span
                    className={`text-micro flex-[0_0_92px] ${
                      isPending ? "text-ink-mute" : "text-ink-dim"
                    }`}
                  >
                    {row.operator}
                  </span>
                  <span
                    className={`text-micro flex-1 min-w-[150px] ${
                      isPending ? "text-ink-mute" : "text-ink"
                    }`}
                  >
                    {row.action}
                  </span>
                  <span
                    className="font-mono text-micro flex-[0_0_118px] overflow-hidden overflow-ellipsis whitespace-nowrap text-ink-mute"
                    title={`本行 ${row.hash}\n前驱 ${row.prevHash}`}
                  >
                    {displayHash(row.hash)}
                  </span>
                  <span className="flex flex-[0_0_52px] justify-end">
                    <span
                      className={`inline-flex h-5 items-center rounded-[var(--trae-radius-4)] border px-1.5 text-micro font-medium ${tag.className}`}
                    >
                      {tag.text}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
