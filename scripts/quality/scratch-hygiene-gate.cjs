#!/usr/bin/env node
/**
 * scratch-hygiene-gate.cjs - 仓库目录卫生闸
 *
 * 判据（两条，都只看"既没被跟踪、也没被忽略"的目录）：
 *   A. 仓库根第一层不许出现这种目录。
 *   B. 任意深度出现这种目录、且它里面【未跟踪文件数 > BULK_FILE_LIMIT】时，也判红。
 *
 * 为什么要常驻，而不是"记得清理一下"：
 *  1. Tailwind v4 的内容源就是「git 看得见的文件」。未跟踪又未忽略的目录会被扫进产物 CSS。
 *     .gitignore 里那段注释记录的实测就是这件事：探针里写过的 border-accent 字样，
 *     真的在 out/renderer 的 CSS 里生成了一条死规则。
 *  2. 出包 scratch 是按【事由】改名的（release-fresh / release-build / release-config /
 *     release-embed / release-next / release-perf …）。.gitignore 以前按具体名字逐条例外，
 *     于是每换一个名字就漏一次。2026-10-22 实测四个这种目录躺在仓库根，每个 356MB。
 *  3. 同一天第一次跑这条闸就抓到第二个：`.venv-sidecar-a/` 824MB、未忽略。
 *     一次误手的 `git add -A` 会把 1GB 级产物推进公开仓。
 *
 * 口径覆盖到哪、漏掉什么（不一起读就会把"闸绿"误读成"仓库干净"）：
 *   - 只判【目录】。未跟踪的单个文件不管：那是正常在制品，管了天天误伤。
 *   - A 条只看第一层，是为了不误伤"刚建好还没 git add 的新组件目录"；
 *     真正的 bulk 产物由 B 条按文件数量兜住（组件目录几十量级，venv/产物目录五万量级）。
 *   - 体积没有精确统计，用【未跟踪文件数】当代理：这道闸要防的是"一大坨不该入库的东西"，
 *     不是"某个大文件"。单个大文件由打包配置与 Git LFS 的账负责。
 *
 * 用法：
 *   node scripts/quality/scratch-hygiene-gate.cjs              正常判
 *   node scripts/quality/scratch-hygiene-gate.cjs --self-test  阳性对照：造违规目录，证它抓得到
 *   环境变量 SCRATCH_GATE_BULK_LIMIT 可压低 B 条阈值（仅供 --self-test 用）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: __dirname, encoding: 'utf8' }).trim();

const BULK_FILE_LIMIT = Number(process.env.SCRATCH_GATE_BULK_LIMIT ?? 200);

/** 刻意豁免的目录（相对仓库根，用 / 分隔）。加名字要写清理由，默认空 = fail-closed。 */
const ALLOWED = [];

/**
 * 「未跟踪且未忽略」的目录集合。
 *
 * 取数口径必须用 `git ls-files --others --exclude-standard --directory`（与 git status 同源），
 * 不能用 `git check-ignore`：2026-10-22 实测 `git check-ignore -q <未忽略目录>/` 退出 0 且
 * 打印一个【空模式】，照它判会把违规目录读成"已忽略"，闸当场变成永不红的摆设。
 */
function looseDirs() {
  const out = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--directory'], {
    cwd: root,
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('/'))
    .map((line) => line.slice(0, -1))
    .filter((dir) => !ALLOWED.includes(dir));
}

function untrackedFileCount(dir) {
  const out = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', `${dir}/`], {
    cwd: root,
    encoding: 'utf8',
  });
  return out.split('\n').filter((l) => l.trim().length > 0).length;
}

function scan() {
  const loose = looseDirs();
  const top = loose.filter((d) => !d.includes('/'));
  const bulk = loose.filter((d) => d.includes('/') && untrackedFileCount(d) > BULK_FILE_LIMIT);
  return { looseCount: loose.length, top, bulk };
}

function report({ top, bulk }) {
  const bad = [...top.map((d) => ({ dir: d, why: '仓库根第一层' })), ...bulk.map((d) => ({ dir: d, why: `未跟踪文件数 ${untrackedFileCount(d)} > ${BULK_FILE_LIMIT}` }))];
  const lines = [`未跟踪又未忽略的目录：A 条 ${top.length} 个｜B 条 ${bulk.length} 个`];
  if (bad.length === 0) {
    lines.push('✅ 没有"两不沾"的目录（口径见文件头：只判目录，A 条只看第一层，B 条按未跟踪文件数）');
    return lines.join('\n');
  }
  lines.push('');
  lines.push('❌ 以下目录既没被跟踪、也没被忽略（Tailwind 会扫进产物；一次 git add -A 就会把它推进仓）：');
  for (const b of bad) lines.push(`   ${b.dir}/  （${b.why}）`);
  lines.push('');
  lines.push('   处置二选一：');
  lines.push('     a) 产物/scratch/venv → .gitignore 里按【前缀】忽略（如 release*/、/.venv*/），别按具体名字逐条加例外；');
  lines.push('     b) 是源码目录       → git add 让它进跟踪集。');
  return lines.join('\n');
}

/**
 * 阳性对照 + 不误伤对照。
 * 这道闸唯一要防的失效形状是"静默全绿"（取数口径错、git 命令报错被吞、判据写反），
 * 所以造一个真违规目录、用【和 CI 完全相同的调用方式】起一个子进程跑正常判，
 * 要求它退出码非零且点名那个目录。
 * 在进程内调 scan() 只能证"列表里有名字"，证不了这道闸真的会把人拦下——
 * 2026-10-22 第一版就是这么自欺的：它拿默认阈值 200 去演一个 2 文件的用例，
 * 自己判自己"量具失效"，而真正该验的退出码路径一次都没跑过。
 *
 * B 条另演一次：用 SCRATCH_GATE_BULK_LIMIT=1 起子进程，造一个 2 文件的二级目录，
 * 要求它被抓出来。对照：src/（已跟踪）与 out/（已忽略）都不许出现在违规名单里。
 */
function runGate(env) {
  try {
    const out = execFileSync(process.execPath, [__filename], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    return { rc: 0, out };
  } catch (e) {
    return { rc: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function selfTest() {
  const canaryA = '.hygiene-canary-a';
  const canaryB = 'scripts/.hygiene-canary-b';
  const dirA = path.join(root, canaryA);
  const dirB = path.join(root, ...canaryB.split('/'));
  if (fs.existsSync(dirA) || fs.existsSync(dirB)) {
    throw new Error('--self-test 拒绝执行：canary 目录已存在（上一轮崩了？先手工确认再删）');
  }
  try {
    fs.mkdirSync(dirA);
    fs.writeFileSync(path.join(dirA, 'probe.txt'), 'canary\n', 'utf8');
    const r1 = runGate({});
    if (r1.rc === 0 || !r1.out.includes(`${canaryA}/`)) {
      throw new Error(`A 条量具失效：造了违规目录 ${canaryA}/，但闸 rc=${r1.rc}、输出没点名它`);
    }
    if (r1.out.includes('   src/')) throw new Error(`A 条误伤：src/（已跟踪）出现在违规名单里`);
    if (r1.out.includes('   out/')) throw new Error(`A 条误伤：out/（已忽略）出现在违规名单里`);

    fs.mkdirSync(dirB, { recursive: true });
    fs.writeFileSync(path.join(dirB, 'p1.txt'), 'x\n', 'utf8');
    fs.writeFileSync(path.join(dirB, 'p2.txt'), 'x\n', 'utf8');
    const r2 = runGate({ SCRATCH_GATE_BULK_LIMIT: '1' });
    if (r2.rc === 0 || !r2.out.includes(`${canaryB}/`)) {
      throw new Error(`B 条量具失效：阈值压到 1、造了 2 个未跟踪文件的二级目录，但闸 rc=${r2.rc}、输出没点名它`);
    }
    console.log(
      `✅ 阳性对照（子进程真跑、读退出码）：A 条 rc=${r1.rc} 抓到 ${canaryA}/；B 条 rc=${r2.rc} 抓到 ${canaryB}/；src/ 与 out/ 均未误伤`,
    );
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }
  const result = scan();
  console.log(report(result));
  if (result.top.length + result.bulk.length > 0) process.exit(1);
}

main();
