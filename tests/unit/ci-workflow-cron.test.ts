/**
 * .github/workflows 里的 schedule.cron 必须是合法表达式。
 *
 * 起因（2026-10-20）：codeql.yml 写成 `cron: "22:00 SUN"`。GitHub 的 cron 要 5 个字段
 * （分 时 日 月 周），这条不合法 ⇒ **整个 workflow 在解析阶段就被拒**，
 * 结果是每次 push 都多出一个「0 个 job、直接 failure」的 run，
 * 每次都给仓库所有者发一封失败邮件，而 CodeQL 从头到尾一次也没真跑过。
 * 这类错的代价不对称：写错的人看不见（本地不跑 CI），收件箱替它记账。
 *
 * 两条判据都跑过真文件与合成反例：只数本地文件不联网，秒级。
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const WORKFLOWS = path.resolve(import.meta.dirname, "../../.github/workflows");

/** 从 workflow 文本里取所有 cron 串（不引 YAML 依赖，cron 行形状固定） */
function cronEntries(text: string): string[] {
  return [...text.matchAll(/^\s*-\s*cron:\s*['"](.+?)['"]\s*$/gm)].map(
    (m) => m[1],
  );
}

/** 合法 = 恰好 5 个字段，且每字段只用 GitHub 允许的字符 */
function badCron(expr: string): string | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5)
    return `需要 5 个字段（分 时 日 月 周），实际 ${fields.length} 个`;
  for (const f of fields)
    if (!/^[\d*,/-]+$/.test(f))
      return `字段 ${f} 不在本仓库允许的写法（只用 数字 * , / - 才不歧义）`;
  return null;
}

function workflowFiles(): string[] {
  return fs
    .readdirSync(WORKFLOWS)
    .filter((f) => /\.(yml|yaml)$/.test(f))
    .map((f) => path.join(WORKFLOWS, f));
}

describe("CI 工作流的 cron 表达式", () => {
  it("每个 schedule.cron 都是 5 字段合法表达式（这条判据扫的是真文件）", () => {
    const offenders: string[] = [];
    let seen = 0;
    for (const file of workflowFiles()) {
      for (const expr of cronEntries(fs.readFileSync(file, "utf8"))) {
        seen++;
        const why = badCron(expr);
        if (why) offenders.push(`${path.basename(file)}: "${expr}" —— ${why}`);
      }
    }
    // 这条测试自己也要有牙：一份 cron 都没有就是判据空转，不算通过
    expect(
      seen,
      ".github/workflows 里一个 cron 都没找到，说明这条判据在空转",
    ).toBeGreaterThan(0);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it('反例：当年那句 "22:00 SUN" 必须被这条尺子量出来', () => {
    expect(badCron("22:00 SUN")).toContain("实际 2 个");
    expect(badCron("0 22 * * 0")).toBeNull();
    expect(badCron("0 22 * * SUN")).toContain("只用 数字");
  });
});
