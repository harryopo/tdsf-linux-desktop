# README 架构图生成器 —— 图里每个数字都要能追到一条命令，改代码后重跑它就同步
#
# 为什么要把它入库：上一版图是 2026-07-25 手画的，之后 React 18→19、退出 Ant Design、
# "12 条黑名单"换成 8 结构 + 7 argv + 226 词表、"14 步协议"证明生产零调用，图上一条都没跟
# —— 公开仓里那张图就成了假话。有生成器才谈得上"重画一次"。
#
# 数字出处（不要手改图里的数，去改这些源，然后重跑本脚本）：
#   IPC 239 = 210 请求-响应 + 29 事件推送   -> npm run audit:ipc
#   已登记契约 65 条                          -> src/shared/ipc-contract.ts
#   命令闸 8 结构 + 7 argv + 226 词表         -> npm run promo:check
#   Provider 7 类                             -> src/main/core/agent/providers/provider-factory.ts 的 switch
#   可信度融合走 D-S / PCR5                    -> ChatCredibility.tsx:69 调 credibilityAssess
#                                                -> ipc/credibility.ts:184 engine.fuseAndAssess
#                                                -> fusion-engine.ts:174/176/181 低冲突 Dempster、高冲突 PCR5
#     （这条 2026-10-19 前一直写成"D-S/PCR5 未上生产"，是抄旧降级表没回代码；改图时一并纠正）
#   设置键那条不写数量：design:gate 钉的是"每个键都有消费者"，数量归它自己管
#
# 这些数在图上是抄的，抄来的就会漂，所以有闸：node scripts/quality/promo-readout.mjs --check-diagram
# （单测 tests/unit/promo-readout.test.ts 里那条"真图对真文件"每次 CI 都跑；请求/事件两条要 audit:ipc，
#   只有 --check 全量模式比得到）
#
# 跑法：python scripts/docs/arch-diagram.py            （写 docs/assets/architecture.svg）
# 校验：python <bilingual-diagram skill>/scripts/fireworks.py check docs/assets/architecture.svg
#       本脚本自己还有一条文字越界闸：文案变长到放不下就报错退出，不靠人看图
# 出 PNG 给人眼复核（本机没有独立 Chromium：Playwright 要的 headless shell 版本对不上、
#   Edge CLI 静默不出文件）：用应用自己的 Electron 起一个隐藏窗 loadFile + capturePage。
#   注意显示器缩放 175%，capturePage 出来的就是 1.75 倍图；窗口开过屏幕高会被裁，别放大到 2 倍。
# GitHub 会直接把 SVG 画出来，所以仓库里只存 SVG，不存会漂移的 PNG。
import os

OUT = os.environ.get("ARCH_OUT", "docs/assets/architecture.svg")

W, H = 1200, 820
BLUE = "#0f6cbd"
BLUE_FILL = "#eaf2fb"
BLUE_EDGE = "#b8d3ef"
INK = "#0f172a"
BODY = "#334155"
MUTED = "#64748b"
TEAL = "#0f766e"
TEAL_FILL = "#e8f4f2"
TEAL_EDGE = "#b5ddd7"
AMBER = "#b45309"
AMBER_FILL = "#fdf3e3"
AMBER_EDGE = "#e8cfa5"
CARD_EDGE = "#d7dee7"
CONTAINER = "#cbd5e1"
FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif"

L = []
A = L.append

# 文案宽度自检：CJK 与全角标点按 1.0em、其余按 0.6em（比 Segoe UI 的实际均值略宽，
# 故意往大了估——图是画出来的，改一个字就可能撑破卡片，而出图这条路在别的机器上不一定通
# （本机 Playwright 缺 headless shell、Electron 偶发 UnknownVizError），所以"放得下"
# 必须能在这里算出来，而不是靠人看图。
def text_width(s, size):
    return sum(size * (0.6 if ord(ch) < 0x2000 else 1.0) for ch in s)


FIT = []  # (文本, 需要宽度, 可用宽度)


def fits(s, size, avail, where):
    need = text_width(s, size)
    FIT.append((s, need, avail))
    if need > avail:
        raise SystemExit(
            "%s 放不下：%r 需要 %.0fpx，可用 %.0fpx —— 缩短文案或加宽，别让它溢出" % (where, s, need, avail)
        )
    return need


def check_pair(w, left, ls, right, rs, gap=60):
    """同一行两头对齐：左标题 + 右说明加起来必须留得住中缝，否则会在中间撞上。"""
    need = text_width(left, ls) + text_width(right, rs)
    if need + gap > w - 32:
        raise SystemExit(
            "同行两头会撞上：%r + %r 合计 %.0fpx，可用 %.0fpx" % (left, right, need, w - 32 - gap)
        )
    return need



def rect(x, y, w, h, fill, edge, dash=None, rx=8):
    A('  <rect x="%d" y="%d" width="%d" height="%d" rx="%d" fill="%s" stroke="%s" stroke-width="1"%s/>'
      % (x, y, w, h, rx, fill, edge, (' stroke-dasharray="%s"' % dash) if dash else ""))


def txt(x, y, s, size=12, fill=BODY, weight=None, anchor=None, avail=None):
    if avail is not None:
        fits(s, size, avail, "文字")
    A('  <text x="%d" y="%d" font-size="%s" fill="%s"%s%s>%s</text>'
      % (x, y, size, fill, (' font-weight="%s"' % weight) if weight else "",
         (' text-anchor="%s"' % anchor) if anchor else "", s))


def pair(x, y, w, left, ls, right, rs, lcol=BLUE, rcol=BODY):
    """一行两头：左标题 + 右说明。自检和落笔共用同一份字符串，改文案不会漏掉检查。"""
    check_pair(w, left, ls, right, rs)
    txt(x + 16, y, left, ls, lcol, "700")
    txt(x + w - 16, y, right, rs, rcol, None, "end")


def card(x, y, w, h, title, sub, sub2=None, fill="#ffffff", edge=CARD_EDGE, tcol=INK, accent=None):
    rect(x, y, w, h, fill, edge)
    if accent:
        A('  <rect x="%d" y="%d" width="4" height="%d" rx="2" fill="%s"/>' % (x, y + 8, h - 16, accent))
    # 卡片内文字从 x+16 起排、右边界留 8，可用宽度是 w-24
    txt(x + 16, y + 23, title, 13.5, tcol, "600", avail=w - 24)
    txt(x + 16, y + 41, sub, 11.5, BODY, avail=w - 24)
    if sub2:
        txt(x + 16, y + 58, sub2, 11.5, BODY, avail=w - 24)


def band(x, y, w, h, title, right, top_row=False):
    """通栏条。top_row=True 时标题走顶部一行（下面还要放卡片）"""
    rect(x, y, w, h, "#f2f7fc", BLUE_EDGE)
    A('  <rect x="%d" y="%d" width="4" height="%d" rx="2" fill="%s"/>' % (x, y + 8, h - 16, BLUE))
    ty = y + 24 if top_row else y + h / 2 + 5
    pair(x, ty, w, title, 14.5, right, 12)

A('<?xml version="1.0" encoding="UTF-8"?>')
A('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d" font-family="%s">' % (W, H, W, H, FONT))
A("  <defs>")
for mid, col in [("blue", BLUE), ("gray", MUTED), ("teal", TEAL), ("amber", AMBER)]:
    A('    <marker id="ar-%s" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">'
      '<polygon points="0 0, 10 3.5, 0 7" fill="%s"/></marker>' % (mid, col))
A("  </defs>")
A('  <rect x="0" y="0" width="%d" height="%d" fill="#ffffff"/>' % (W, H))
txt(60, 44, "TDSF-Linux Desktop · 三进程架构", 23, INK, "700", avail=W - 120)
txt(60, 70, "SSH 终端 + AI 辅助 + 高危命令拦截 + 可信决策 —— 每个框都是仓库里真在跑的模块，按条件降级的单独标",
    13.5, MUTED, avail=W - 120)


# ---- Electron 容器 ----
CX, CY, CW, CH = 60, 98, 1080, 516
A('  <rect x="%d" y="%d" width="%d" height="%d" rx="12" fill="none" stroke="%s" stroke-width="1.5" stroke-dasharray="7 5"/>'
  % (CX, CY, CW, CH, CONTAINER))
txt(CX + 18, CY + 24, "Electron 桌面应用（Chromium 渲染 + Node 主进程）", 13, MUTED, "700",
    avail=CW - 36)

# ---- 渲染进程（标题走顶部一行，卡片在下）----
band(90, 136, 1020, 108, "渲染进程  src/renderer/", "React 19 · Zustand 5 · Tailwind 4 · 无 Ant Design", top_row=True)
chips = [
    ("工作台", "终端 / IDE / 预览"),
    ("AI 面板", "对话 · 决策卡 · 用量"),
    ("知识库 · 教程", "词库 / 爬虫聚合"),
    ("设置 · 历史 · 监控", "每个设置键都接了消费者"),
]
bw, bgap, x0 = 231, 20, 108
for i, (t, s) in enumerate(chips):
    card(x0 + i * (bw + bgap), 172, bw, 60, t, s, fill="#ffffff")

# ---- 预加载 ----
band(90, 288, 1020, 54, "预加载  src/preload/", "contextBridge 按域拆分 · 入参走 zod 契约判定 · 只桥接不实现")

# ---- 主进程 ----
rect(90, 386, 1020, 206, "#f2f7fc", BLUE_EDGE)
A('  <rect x="90" y="394" width="4" height="190" rx="2" fill="%s"/>' % BLUE)
pair(90, 410, 1020, "主进程  src/main/", 14.5, "Node.js · 命令一律过闸，凭据不出进程边界", 12)
main_boxes = [
    ("SSH 客户端", "ssh2 · known_hosts 三态", "跳板机同样校验主机密钥"),
    ("本机终端", "node-pty", "伪终端在进程内，会话按标签管理"),
    ("AI 编排", "Vercel AI SDK 7", "请求级超时 + 单一重试栈"),
    ("命令闸", "8 结构 + 7 argv + 226 词表", "键入/粘贴与 AI 同一条闸"),
    ("可信度融合", "Shafer 折扣 → D-S / PCR5", "冲突高走 PCR5，低走 Dempster"),
    ("持久化", "better-sqlite3 + sqlite-vec", "扩展加载失败 → 界面显式降级"),
    ("MCP 网关", "@modelcontextprotocol/sdk", "本地工具 + 外部 stdio"),
    ("凭据保管", "safeStorage（DPAPI）", "密文存 userData，不入库"),
]
for i, (t, s, s2) in enumerate(main_boxes):
    col, row = i % 4, i // 4
    card(x0 + col * (bw + bgap), 424 + row * 78, bw, 70, t, s, s2, accent=BLUE)

# ---- IPC 走廊 ----
# 走廊里两条竖线之间只有 430→700 这一段，左边那条说明文字不许越过右边的竖线
A('  <line x1="430" y1="244" x2="430" y2="288" stroke="%s" stroke-width="2" marker-end="url(#ar-blue)"/>' % BLUE)
txt(444, 270, "invoke 请求（210 条通道）", 12, BODY, avail=700 - 444 - 10)
A('  <line x1="700" y1="288" x2="700" y2="244" stroke="%s" stroke-width="1.8" stroke-dasharray="5 4" marker-end="url(#ar-gray)"/>' % MUTED)
txt(714, 270, "事件推送（29 条通道）", 12, MUTED, avail=1110 - 714)
A('  <line x1="430" y1="342" x2="430" y2="386" stroke="%s" stroke-width="2" marker-end="url(#ar-blue)"/>' % BLUE)
txt(444, 368, "65 条已登记 zod 契约（其余未收口）", 12, BODY, avail=700 - 444 - 10)
A('  <line x1="700" y1="386" x2="700" y2="342" stroke="%s" stroke-width="1.8" stroke-dasharray="5 4" marker-end="url(#ar-gray)"/>' % MUTED)

# ---- 外部服务 ----
# 这一行不再另起"外部"标题：第一颗落线正好落在标题会占的横带上，怎么放都撞。
# 四个框名本身就说明它们是外面的东西，图例再给颜色口径。
ext = [
    ("SSH 服务器", "目标主机 / 跳板机", "SSH · SFTP · 端口转发", TEAL, TEAL_FILL, TEAL_EDGE, "teal", False),
    ("LLM Provider", "7 类兼容端点", "流式补全 + 工具调用", TEAL, TEAL_FILL, TEAL_EDGE, "teal", False),
    ("Python 侧车", "Drain3 日志模板", "缺 venv → 整条降级", AMBER, AMBER_FILL, AMBER_EDGE, "amber", True),
    ("Langfuse 追踪", "决策可观测", "无 Key → 自动关闭", AMBER, AMBER_FILL, AMBER_EDGE, "amber", True),
]
for i, (t, s, lbl, colr, fl, ed, mid, dashed) in enumerate(ext):
    bx = x0 + i * (bw + bgap)
    cx = bx + bw / 2
    card(bx, 672, bw, 60, t, s, fill=fl, edge=ed, tcol=colr, accent=colr)
    A('  <line x1="%d" y1="614" x2="%d" y2="672" stroke="%s" stroke-width="1.8" %s marker-end="url(#ar-%s)"/>'
      % (cx, cx, colr, ('stroke-dasharray="5 4"' if dashed else ""), mid))
    # 标签压在竖线上：按 skill 的兜底做法垫一块背景，而不是把字挪到隔壁列。
    # 垫块的宽度用同一份宽度模型算（早先是 len()*7，遇到 CJK 比字号还宽就把字漏在垫块外）
    tw = text_width(lbl, 11) + 12
    A('  <rect x="%.0f" y="636" width="%.0f" height="18" rx="4" fill="#ffffff" opacity="0.95"/>' % (cx - tw / 2, tw))
    txt(cx, 649, lbl, 11, colr, None, "middle", avail=bw - 12)

# ---- shared 说明 + 图例 ----
rect(60, 756, 520, 44, "#f8fafc", CONTAINER, dash="6 4")
txt(76, 774, "src/shared/ · 跨进程单源", 12.5, INK, "700", avail=580 - 76 - 8)
txt(76, 791, "IPC 通道名 · 可信度表 · boot 载荷 —— 编译期共享，不在运行时链路上", 11.5, BODY,
    avail=580 - 76 - 8)

rect(600, 756, 540, 44, "#f8fafc", CARD_EDGE)
lx = 616
A('  <line x1="%d" y1="779" x2="%d" y2="779" stroke="%s" stroke-width="2" marker-end="url(#ar-blue)"/>' % (lx, lx + 26, BLUE))
txt(lx + 32, 783, "请求", 11.5, BODY, avail=82 - 32 - 8)
lx2 = lx + 82
A('  <line x1="%d" y1="779" x2="%d" y2="779" stroke="%s" stroke-width="1.8" stroke-dasharray="5 4" marker-end="url(#ar-gray)"/>' % (lx2, lx2 + 26, MUTED))
txt(lx2 + 32, 783, "事件", 11.5, BODY, avail=82 - 32 - 8)
lx3 = lx2 + 82
A('  <line x1="%d" y1="779" x2="%d" y2="779" stroke="%s" stroke-width="1.8" marker-end="url(#ar-teal)"/>' % (lx3, lx3 + 26, TEAL))
txt(lx3 + 32, 783, "外部调用", 11.5, BODY, avail=104 - 32 - 8)
lx4 = lx3 + 104
A('  <line x1="%d" y1="779" x2="%d" y2="779" stroke="%s" stroke-width="1.8" stroke-dasharray="5 4" marker-end="url(#ar-amber)"/>' % (lx4, lx4 + 26, AMBER))
txt(lx4 + 32, 783, "按条件降级", 11.5, AMBER, avail=1140 - 8 - (lx4 + 32))

A("</svg>")
with open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(L) + "\n")
print("wrote %s (%d bytes, %d lines)" % (OUT, os.path.getsize(OUT), len(L)))
tightest = min(FIT, key=lambda r: r[2] - r[1])
print("受检文字 %d 行，最紧的一行余 %.0fpx/%.0fpx：%s"
      % (len(FIT), tightest[2] - tightest[1], tightest[2], tightest[0]))
