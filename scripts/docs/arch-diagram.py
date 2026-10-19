# README 架构图生成器 —— 图里每个数字都要能追到一条命令，改代码后重跑它就同步
#
# 为什么要把它入库：上一版图是 2026-07-25 手画的，之后 React 18→19、退出 Ant Design、
# "12 条黑名单"换成 8 结构 + 7 argv + 226 词表、"14 步协议"证明生产零调用，图上一条都没跟
# —— 公开仓里那张图就成了假话。有生成器才谈得上"重画一次"。
#
# 数字出处（不要手改图里的数，去改这些源，然后重跑本脚本）：
#   IPC 272 = 232 请求-响应 + 40 事件推送   -> npm run audit:ipc
#   已登记契约 35 条                          -> src/shared/ipc-contract.ts
#   命令闸 8 结构 + 7 argv + 226 词表         -> npm run promo:check
#   Provider 7 类                             -> src/main/core/agent/providers/provider-factory.ts 的 switch
#   设置键 33 个                              -> npm run design:gate
#
# 跑法：python scripts/docs/arch-diagram.py            （写 docs/assets/architecture.svg）
# 校验：python <bilingual-diagram skill>/scripts/fireworks.py check docs/assets/architecture.svg
# 出 PNG（本机 Playwright 缺 headless shell、Edge CLI 静默不出文件，用 Electron 自己画）：
#   ./node_modules/electron/dist/electron.exe <一个 loadFile+capturePage 的小脚本> 
#     docs/assets/architecture.svg /tmp/arch.png
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

A('<?xml version="1.0" encoding="UTF-8"?>')
A('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d" font-family="%s">' % (W, H, W, H, FONT))
A("  <defs>")
for mid, col in [("blue", BLUE), ("gray", MUTED), ("teal", TEAL), ("amber", AMBER)]:
    A('    <marker id="ar-%s" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">'
      '<polygon points="0 0, 10 3.5, 0 7" fill="%s"/></marker>' % (mid, col))
A("  </defs>")
A('  <rect x="0" y="0" width="%d" height="%d" fill="#ffffff"/>' % (W, H))
A('  <text x="60" y="44" font-size="23" font-weight="700" fill="%s">TDSF-Linux Desktop · 三进程架构</text>' % INK)
A('  <text x="60" y="70" font-size="13.5" fill="%s">SSH 终端 + AI 辅助 + 高危命令拦截 + 可信决策 —— 每个框都是仓库里真在跑的模块，按条件降级的单独标</text>' % MUTED)


def rect(x, y, w, h, fill, edge, dash=None, rx=8):
    A('  <rect x="%d" y="%d" width="%d" height="%d" rx="%d" fill="%s" stroke="%s" stroke-width="1"%s/>'
      % (x, y, w, h, rx, fill, edge, (' stroke-dasharray="%s"' % dash) if dash else ""))


def txt(x, y, s, size=12, fill=BODY, weight=None, anchor=None):
    A('  <text x="%d" y="%d" font-size="%s" fill="%s"%s%s>%s</text>'
      % (x, y, size, fill, (' font-weight="%s"' % weight) if weight else "",
         (' text-anchor="%s"' % anchor) if anchor else "", s))


def card(x, y, w, h, title, sub, sub2=None, fill="#ffffff", edge=CARD_EDGE, tcol=INK, accent=None):
    rect(x, y, w, h, fill, edge)
    if accent:
        A('  <rect x="%d" y="%d" width="4" height="%d" rx="2" fill="%s"/>' % (x, y + 8, h - 16, accent))
    txt(x + 16, y + 23, title, 13.5, tcol, "600")
    txt(x + 16, y + 41, sub, 11.5, BODY)
    if sub2:
        txt(x + 16, y + 58, sub2, 11.5, BODY)


def band(x, y, w, h, title, right, top_row=False):
    """通栏条。top_row=True 时标题走顶部一行（下面还要放卡片）"""
    rect(x, y, w, h, "#f2f7fc", BLUE_EDGE)
    A('  <rect x="%d" y="%d" width="4" height="%d" rx="2" fill="%s"/>' % (x, y + 8, h - 16, BLUE))
    ty = y + 24 if top_row else y + h / 2 + 5
    txt(x + 16, ty, title, 14.5, BLUE, "700")
    if right:
        if top_row:
            txt(x + w - 16, ty, right, 12, BODY, None, "end")
        else:
            txt(x + w - 16, ty, right, 12, BODY, None, "end")


# ---- Electron 容器 ----
CX, CY, CW, CH = 60, 98, 1080, 516
A('  <rect x="%d" y="%d" width="%d" height="%d" rx="12" fill="none" stroke="%s" stroke-width="1.5" stroke-dasharray="7 5"/>'
  % (CX, CY, CW, CH, CONTAINER))
txt(CX + 18, CY + 24, "Electron 桌面应用（Chromium 渲染 + Node 主进程）", 13, MUTED, "700")

# ---- 渲染进程（标题走顶部一行，卡片在下）----
band(90, 136, 1020, 108, "渲染进程  src/renderer/", "React 19 · Zustand 5 · Tailwind 4 · 无 Ant Design", top_row=True)
chips = [
    ("工作台", "终端 / IDE / 预览"),
    ("AI 面板", "对话 · 决策卡 · 用量"),
    ("知识库 · 教程", "词库 / 爬虫聚合"),
    ("设置 · 历史 · 监控", "33 个设置键全接消费者"),
]
bw, bgap, x0 = 231, 20, 108
for i, (t, s) in enumerate(chips):
    card(x0 + i * (bw + bgap), 172, bw, 60, t, s, fill="#ffffff")

# ---- 预加载 ----
band(90, 288, 1020, 54, "预加载  src/preload/", "contextBridge 按域拆分 · 入参走 zod 契约判定 · 只桥接不实现")

# ---- 主进程 ----
rect(90, 386, 1020, 206, "#f2f7fc", BLUE_EDGE)
A('  <rect x="90" y="394" width="4" height="190" rx="2" fill="%s"/>' % BLUE)
txt(106, 410, "主进程  src/main/", 14.5, BLUE, "700")
txt(1094, 410, "Node.js · 命令一律过闸，凭据不出进程边界", 12, BODY, None, "end")
main_boxes = [
    ("SSH 客户端", "ssh2 · known_hosts 三态", "跳板机同样校验主机密钥"),
    ("本机终端", "node-pty", "跑在 utilityProcess 里"),
    ("AI 编排", "Vercel AI SDK 7", "请求级超时 + 单一重试栈"),
    ("命令闸", "8 结构 + 7 argv + 226 词表", "键入/粘贴与 AI 同一条闸"),
    ("可信度融合", "多源证据折扣融合", "D-S / PCR5 在库，未上生产"),
    ("持久化", "better-sqlite3 + sqlite-vec", "扩展加载失败 → 界面显式降级"),
    ("MCP 网关", "@modelcontextprotocol/sdk", "本地工具 + 外部 stdio"),
    ("凭据保管", "safeStorage（DPAPI）", "密文存 userData，不入库"),
]
for i, (t, s, s2) in enumerate(main_boxes):
    col, row = i % 4, i // 4
    card(x0 + col * (bw + bgap), 424 + row * 78, bw, 70, t, s, s2, accent=BLUE)

# ---- IPC 走廊 ----
A('  <line x1="430" y1="244" x2="430" y2="288" stroke="%s" stroke-width="2" marker-end="url(#ar-blue)"/>' % BLUE)
txt(444, 270, "invoke 请求（232 条通道）", 12, BODY)
A('  <line x1="700" y1="288" x2="700" y2="244" stroke="%s" stroke-width="1.8" stroke-dasharray="5 4" marker-end="url(#ar-gray)"/>' % MUTED)
txt(714, 270, "事件推送（40 条通道）", 12, MUTED)
A('  <line x1="430" y1="342" x2="430" y2="386" stroke="%s" stroke-width="2" marker-end="url(#ar-blue)"/>' % BLUE)
txt(444, 368, "35 条已登记 zod 契约，其余为未收口存量", 12, BODY)
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
    # 标签压在竖线上：按 skill 的兜底做法垫一块背景，而不是把字挪到隔壁列
    tw = len(lbl) * 7 + 12
    A('  <rect x="%d" y="636" width="%d" height="18" rx="4" fill="#ffffff" opacity="0.95"/>' % (cx - tw / 2, tw))
    txt(cx, 649, lbl, 11, colr, None, "middle")

# ---- shared 说明 + 图例 ----
rect(60, 756, 520, 44, "#f8fafc", CONTAINER, dash="6 4")
txt(76, 774, "src/shared/ · 跨进程单源", 12.5, INK, "700")
txt(76, 791, "IPC 通道名 · 可信度表 · boot 载荷 —— 编译期共享，不在运行时链路上", 11.5, BODY)

rect(600, 756, 540, 44, "#f8fafc", CARD_EDGE)
lx = 616
A('  <line x1="%d" y1="779" x2="%d" y2="779" stroke="%s" stroke-width="2" marker-end="url(#ar-blue)"/>' % (lx, lx + 26, BLUE))
txt(lx + 32, 783, "请求", 11.5, BODY)
lx2 = lx + 82
A('  <line x1="%d" y1="779" x2="%d" y2="779" stroke="%s" stroke-width="1.8" stroke-dasharray="5 4" marker-end="url(#ar-gray)"/>' % (lx2, lx2 + 26, MUTED))
txt(lx2 + 32, 783, "事件", 11.5, BODY)
lx3 = lx2 + 82
A('  <line x1="%d" y1="779" x2="%d" y2="779" stroke="%s" stroke-width="1.8" marker-end="url(#ar-teal)"/>' % (lx3, lx3 + 26, TEAL))
txt(lx3 + 32, 783, "外部调用", 11.5, BODY)
lx4 = lx3 + 104
A('  <line x1="%d" y1="779" x2="%d" y2="779" stroke="%s" stroke-width="1.8" stroke-dasharray="5 4" marker-end="url(#ar-amber)"/>' % (lx4, lx4 + 26, AMBER))
txt(lx4 + 32, 783, "按条件降级", 11.5, AMBER)

A("</svg>")
with open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(L) + "\n")
print("wrote %s (%d bytes, %d lines)" % (OUT, os.path.getsize(OUT), len(L)))
