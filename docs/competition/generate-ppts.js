/**
 * TDSF Linux Desktop 比赛 PPT 生成脚本
 * 输出 4 份 PPTX 到当前目录
 * 使用真实数据（v1.0.0 / commit bbf6356 已通过门禁验证）
 */
const pptxgen = require('pptxgenjs');
const path = require('path');

// ============ 公共样式 ============
const COLORS = {
  primary: '4F46E5',       // 主色（亮）#4f46e5
  primaryLight: '818CF8',  // 主色（暗）#818cf8
  success: '10B981',        // 成功 #10b981
  warning: 'F59E0B',        // 警告 #f59e0b
  error: 'EF4444',          // 错误 #ef4444
  bgDark: '1A1B1D',         // 背景暗 #1a1b1d
  bgCard: '232428',         // 卡片背景
  textPrimary: 'F4F4F5',    // 主文字
  textSecondary: 'A1A1AA',  // 次文字
  textMuted: '71717A',      // 弱文字
  divider: '3F3F46',        // 分割线
  accent: '06B6D4',          // 强调
};

const FONTS = {
  title: 'Microsoft YaHei',    // 标题（方正黑体替代）
  body: 'Microsoft YaHei',     // 正文（方正楷体替代）
  code: 'Consolas',            // 代码（JetBrains Mono 替代）
};

const FOOTER_TEXT = 'v1.0.0 · 2026-07-25 · TDSF';

// 16:9 尺寸
const SLIDE_W = 13.33;
const SLIDE_H = 7.5;

// ============ 通用辅助函数 ============
function addDarkBackground(slide) {
  slide.background = { color: COLORS.bgDark };
}

function addFooter(slide) {
  slide.addText(FOOTER_TEXT, {
    x: 11.5, y: 7.15, w: 1.7, h: 0.25,
    fontSize: 8, color: COLORS.textMuted, fontFace: FONTS.body,
    align: 'right',
  });
}

function addPageNumber(slide, num, total) {
  slide.addText(`${num} / ${total}`, {
    x: 0.2, y: 7.15, w: 1.5, h: 0.25,
    fontSize: 8, color: COLORS.textMuted, fontFace: FONTS.body,
    align: 'left',
  });
  addFooter(slide);
}

function addTitleBar(slide, title, subtitle) {
  // 标题栏背景
  slide.addShape('rect', {
    x: 0, y: 0, w: SLIDE_W, h: 1.0,
    fill: { color: COLORS.primary },
  });
  // 标题
  slide.addText(title, {
    x: 0.4, y: 0.15, w: 12.5, h: 0.55,
    fontSize: 22, bold: true, color: 'FFFFFF', fontFace: FONTS.title,
  });
  // 副标题
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.4, y: 0.68, w: 12.5, h: 0.28,
      fontSize: 11, color: 'E0E7FF', fontFace: FONTS.body,
    });
  }
  // 装饰条
  slide.addShape('rect', {
    x: 0, y: 1.0, w: SLIDE_W, h: 0.04,
    fill: { color: COLORS.primaryLight },
  });
}

function addCard(slide, x, y, w, h, opts = {}) {
  slide.addShape('rect', {
    x, y, w, h,
    fill: { color: opts.fill || COLORS.bgCard },
    line: { color: opts.border || COLORS.divider, width: 0.5 },
    rectRadius: 0.05,
  });
}

function addKPI(slide, x, y, w, h, number, label, color) {
  addCard(slide, x, y, w, h);
  slide.addText(number, {
    x, y: y + 0.15, w, h: 0.55,
    fontSize: 26, bold: true, color: color || COLORS.primaryLight,
    fontFace: FONTS.title, align: 'center',
  });
  slide.addText(label, {
    x, y: y + 0.7, w, h: 0.3,
    fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body,
    align: 'center',
  });
}

// ============ PPT-01 产品介绍 + 技术架构 ============
function genPPT01() {
  const pptx = new pptxgen();
  pptx.defineLayout({ name: 'TDSF', width: SLIDE_W, height: SLIDE_H });
  pptx.layout = 'TDSF';
  pptx.author = 'TDSF Team';
  pptx.title = 'TDSF Linux Desktop 产品介绍与技术架构';

  const TOTAL = 10;

  // ---- Page 1: 封面 ----
  const s1 = pptx.addSlide();
  addDarkBackground(s1);
  // 顶部色带
  s1.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: 0.3, fill: { color: COLORS.primary } });
  // 中央标题区
  s1.addShape('rect', { x: 1.0, y: 2.3, w: 11.3, h: 2.8, fill: { color: COLORS.bgCard }, line: { color: COLORS.primary, width: 1 } });
  s1.addText('TDSF Linux Desktop', {
    x: 1.0, y: 2.5, w: 11.3, h: 0.9,
    fontSize: 40, bold: true, color: 'FFFFFF', fontFace: FONTS.title, align: 'center',
  });
  s1.addText('面向 Linux 运维的人机协同可信决策桌面助手', {
    x: 1.0, y: 3.4, w: 11.3, h: 0.5,
    fontSize: 20, color: COLORS.primaryLight, fontFace: FONTS.body, align: 'center',
  });
  s1.addText('比赛交付版  v1.0.0', {
    x: 1.0, y: 4.0, w: 11.3, h: 0.4,
    fontSize: 16, color: COLORS.warning, fontFace: FONTS.body, align: 'center', bold: true,
  });
  s1.addText('2026-07-25  ·  commit bbf6356  ·  tag v1.0.0 已推送 origin/master', {
    x: 1.0, y: 4.5, w: 11.3, h: 0.4,
    fontSize: 12, color: COLORS.textSecondary, fontFace: FONTS.body, align: 'center',
  });
  // 底部 KPI 横条
  addKPI(s1, 1.0, 5.5, 2.7, 1.0, '14.8万', '代码行数');
  addKPI(s1, 3.9, 5.5, 2.7, 1.0, '1346', '测试用例', COLORS.success);
  addKPI(s1, 6.8, 5.5, 2.7, 1.0, '4/5', '五绿门禁', COLORS.warning);
  addKPI(s1, 9.7, 5.5, 2.7, 1.0, '18', '开源复用', COLORS.accent);
  addFooter(s1);

  // ---- Page 2: 项目背景与定位 ----
  const s2 = pptx.addSlide();
  addDarkBackground(s2);
  addTitleBar(s2, '项目背景与定位', 'Linux 运维痛点 → TDSF 解决思路');
  // 左半：痛点
  addCard(s2, 0.4, 1.3, 6.2, 5.5);
  s2.addText('🔴 Linux 运维 4 大痛点', { x: 0.6, y: 1.45, w: 5.8, h: 0.4, fontSize: 14, bold: true, color: COLORS.error, fontFace: FONTS.title });
  const pains = [
    ['高危命令误操作', 'rm -rf /、chmod 777 等无审批直接执行'],
    ['AI 幻觉', 'LLM 给出错误命令建议无证据支撑'],
    ['决策不透明', '黑盒模型，证据来源不可追溯'],
    ['单点依赖', '单一 LLM Provider 故障即全盘失效'],
  ];
  pains.forEach((p, i) => {
    const y = 1.95 + i * 1.15;
    s2.addShape('rect', { x: 0.6, y, w: 0.08, h: 1.0, fill: { color: COLORS.error } });
    s2.addText(p[0], { x: 0.85, y, w: 5.5, h: 0.4, fontSize: 12, bold: true, color: COLORS.textPrimary, fontFace: FONTS.title });
    s2.addText(p[1], { x: 0.85, y: y + 0.4, w: 5.5, h: 0.5, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body });
  });
  // 右半：解决思路
  addCard(s2, 6.75, 1.3, 6.2, 5.5);
  s2.addText('🟢 TDSF 解决思路', { x: 6.95, y: 1.45, w: 5.8, h: 0.4, fontSize: 14, bold: true, color: COLORS.success, fontFace: FONTS.title });
  const sols = [
    ['人机协同', 'HITL CoPilot 模式，87.5% 接受率 > 25% 完全自主'],
    ['可信决策', 'D-S 证据理论 + PCR5 融合，6 源证据透明'],
    ['HITL 审批', '三态权限（ALWAYS/AUTO/NEVER），主后台解耦'],
    ['多 Provider 容错', '8 个 Provider 接入，直采+兑底双轨'],
  ];
  sols.forEach((p, i) => {
    const y = 1.95 + i * 1.15;
    s2.addShape('rect', { x: 6.95, y, w: 0.08, h: 1.0, fill: { color: COLORS.success } });
    s2.addText(p[0], { x: 7.2, y, w: 5.5, h: 0.4, fontSize: 12, bold: true, color: COLORS.textPrimary, fontFace: FONTS.title });
    s2.addText(p[1], { x: 7.2, y: y + 0.4, w: 5.5, h: 0.5, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body });
  });
  addPageNumber(s2, 2, TOTAL);

  // ---- Page 3: 核心功能矩阵 ----
  const s3 = pptx.addSlide();
  addDarkBackground(s3);
  addTitleBar(s3, '核心功能矩阵', '4 大模块 · 端到端覆盖 SSH / AI / 安全 / 日志');
  const modules = [
    {
      no: '①', title: 'SSH 终端', color: COLORS.primaryLight,
      tech: 'xterm.js + Electerm SFTP',
      points: ['会话复用 + SFTP 双向传输', '智能补全 Addon（ghost text）', 'Frecency 评分 + SQLite 持久化'],
    },
    {
      no: '②', title: 'AI 辅助', color: COLORS.accent,
      tech: '多 Provider + PAOR 循环',
      points: ['8 个 Provider 容错接入', 'PAOR 9 子 Agent 自主循环', 'CoT 透明化 + Token 可见'],
    },
    {
      no: '③', title: '高危命令拦截', color: COLORS.error,
      tech: '白名单 + ML 风险评分',
      points: ['白名单策略命中即拦', 'D-S 证据融合风险评分', '三态审批 ALWAYS/AUTO/NEVER'],
    },
    {
      no: '④', title: '日志分析', color: COLORS.success,
      tech: 'SELinux audit + journald',
      points: ['Python Sidecar 7932 端口', 'SELinux AVC 智能解析', 'journald 全文索引'],
    },
  ];
  modules.forEach((m, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.4 + col * 6.45;
    const y = 1.3 + row * 2.85;
    addCard(s3, x, y, 6.25, 2.7);
    s3.addShape('rect', { x, y, w: 0.12, h: 2.7, fill: { color: m.color } });
    s3.addText(m.no, { x: x + 0.3, y: y + 0.15, w: 0.6, h: 0.6, fontSize: 28, bold: true, color: m.color, fontFace: FONTS.title });
    s3.addText(m.title, { x: x + 0.95, y: y + 0.2, w: 5.0, h: 0.5, fontSize: 18, bold: true, color: COLORS.textPrimary, fontFace: FONTS.title });
    s3.addText(`技术栈：${m.tech}`, { x: x + 0.95, y: y + 0.7, w: 5.0, h: 0.3, fontSize: 10, color: m.color, fontFace: FONTS.code, italic: true });
    m.points.forEach((p, j) => {
      s3.addText(`▸ ${p}`, { x: x + 0.3, y: y + 1.15 + j * 0.45, w: 5.8, h: 0.4, fontSize: 11, color: COLORS.textPrimary, fontFace: FONTS.body });
    });
  });
  addPageNumber(s3, 3, TOTAL);

  // ---- Page 4: 技术架构总览 ----
  const s4 = pptx.addSlide();
  addDarkBackground(s4);
  addTitleBar(s4, '技术架构总览', '三层架构 · Main Process / Renderer / Python Sidecar');
  // Main Process
  addCard(s4, 0.4, 1.3, 12.5, 1.5, { fill: '2D2A4A', border: COLORS.primary });
  s4.addText('Main Process (Electron Main)', { x: 0.6, y: 1.4, w: 6.0, h: 0.4, fontSize: 14, bold: true, color: COLORS.primaryLight, fontFace: FONTS.title });
  s4.addText('IPC 4 步同步铁律 · McpLifecycleHardened 5 阶段状态机 · SFTP 会话复用 · 文件系统/进程管理', { x: 0.6, y: 1.85, w: 12.1, h: 0.4, fontSize: 11, color: COLORS.textSecondary, fontFace: FONTS.body });
  s4.addText('Node.js 20+', { x: 10.5, y: 1.4, w: 2.3, h: 0.4, fontSize: 10, color: COLORS.warning, fontFace: FONTS.code, align: 'right', bold: true });
  // 连接箭头
  s4.addShape('downArrow', { x: 6.5, y: 2.85, w: 0.4, h: 0.3, fill: { color: COLORS.primaryLight } });
  // Renderer
  addCard(s4, 0.4, 3.25, 12.5, 1.5, { fill: '1A3A4A', border: COLORS.accent });
  s4.addText('Renderer (React + TypeScript)', { x: 0.6, y: 3.35, w: 6.0, h: 0.4, fontSize: 14, bold: true, color: COLORS.accent, fontFace: FONTS.title });
  s4.addText('10 个 Zustand store · Monaco Editor (VS Code 同源) · xterm.js 补全 Addon · Tailwind CSS', { x: 0.6, y: 3.8, w: 12.1, h: 0.4, fontSize: 11, color: COLORS.textSecondary, fontFace: FONTS.body });
  s4.addText('React 18', { x: 10.5, y: 3.35, w: 2.3, h: 0.4, fontSize: 10, color: COLORS.warning, fontFace: FONTS.code, align: 'right', bold: true });
  // 双向箭头
  s4.addShape('upDownArrow', { x: 6.5, y: 4.85, w: 0.4, h: 0.3, fill: { color: COLORS.success } });
  // Python Sidecar
  addCard(s4, 0.4, 5.25, 12.5, 1.7, { fill: '1A4A2E', border: COLORS.success });
  s4.addText('Python Sidecar (3 进程隔离)', { x: 0.6, y: 5.35, w: 6.0, h: 0.4, fontSize: 14, bold: true, color: COLORS.success, fontFace: FONTS.title });
  s4.addText('stdio JSON-RPC 通信', { x: 0.6, y: 5.75, w: 6.0, h: 0.3, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.code });
  // 3 进程小卡
  const procs = [
    ['SRE', '7931', '风险评估'],
    ['Analytics', '7932', '日志分析'],
    ['Agent', '7933', '决策推理'],
  ];
  procs.forEach((p, i) => {
    const x = 7.0 + i * 1.95;
    addCard(s4, x, 5.45, 1.8, 1.3, { fill: '0F2A1A' });
    s4.addText(p[0], { x, y: 5.5, w: 1.8, h: 0.35, fontSize: 12, bold: true, color: COLORS.success, fontFace: FONTS.title, align: 'center' });
    s4.addText(`:${p[1]}`, { x, y: 5.85, w: 1.8, h: 0.3, fontSize: 11, color: COLORS.warning, fontFace: FONTS.code, align: 'center', bold: true });
    s4.addText(p[2], { x, y: 6.2, w: 1.8, h: 0.3, fontSize: 9, color: COLORS.textSecondary, fontFace: FONTS.body, align: 'center' });
  });
  addPageNumber(s4, 4, TOTAL);

  // ---- Page 5: 主进程核心能力 ----
  const s5 = pptx.addSlide();
  addDarkBackground(s5);
  addTitleBar(s5, '主进程核心能力', 'IPC 同步铁律 · 状态机 · 会话复用');
  // 左：IPC 4 步
  addCard(s5, 0.4, 1.3, 4.1, 5.5);
  s5.addText('IPC 4 步同步铁律', { x: 0.55, y: 1.45, w: 3.8, h: 0.4, fontSize: 13, bold: true, color: COLORS.primaryLight, fontFace: FONTS.title });
  const ipcSteps = [
    ['1. validate', '入参 schema 校验'],
    ['2. auth', '会话权限校验'],
    ['3. execute', '主逻辑执行'],
    ['4. audit', '审计日志落盘'],
  ];
  ipcSteps.forEach((s, i) => {
    const y = 1.95 + i * 1.1;
    s5.addShape('rect', { x: 0.6, y, w: 0.08, h: 0.95, fill: { color: COLORS.primaryLight } });
    s5.addText(s[0], { x: 0.8, y, w: 3.5, h: 0.4, fontSize: 12, bold: true, color: COLORS.textPrimary, fontFace: FONTS.code });
    s5.addText(s[1], { x: 0.8, y: y + 0.4, w: 3.5, h: 0.5, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body });
  });
  // 中：McpLifecycleHardened 5 阶段
  addCard(s5, 4.65, 1.3, 4.4, 5.5);
  s5.addText('McpLifecycleHardened', { x: 4.8, y: 1.45, w: 4.1, h: 0.4, fontSize: 13, bold: true, color: COLORS.warning, fontFace: FONTS.title });
  s5.addText('5 阶段状态机', { x: 4.8, y: 1.85, w: 4.1, h: 0.3, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body });
  const states = [
    ['Init', '初始化资源', COLORS.textMuted],
    ['Starting', '启动 MCP server', COLORS.warning],
    ['Ready', '健康检查通过', COLORS.success],
    ['Stopping', '优雅停止', COLORS.warning],
    ['Stopped', 'PID 验证已退出', COLORS.textMuted],
  ];
  states.forEach((s, i) => {
    const y = 2.25 + i * 0.85;
    s5.addShape('ellipse', { x: 4.85, y: y + 0.05, w: 0.25, h: 0.25, fill: { color: s[2] } });
    s5.addText(s[0], { x: 5.2, y, w: 1.6, h: 0.35, fontSize: 12, bold: true, color: s[2], fontFace: FONTS.code });
    s5.addText(s[1], { x: 6.8, y, w: 2.1, h: 0.35, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body });
  });
  // 右：SFTP 会话复用
  addCard(s5, 9.2, 1.3, 3.75, 5.5);
  s5.addText('SFTP 会话复用', { x: 9.35, y: 1.45, w: 3.5, h: 0.4, fontSize: 13, bold: true, color: COLORS.accent, fontFace: FONTS.title });
  s5.addText('Electerm 模块抽取', { x: 9.35, y: 1.85, w: 3.5, h: 0.3, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body });
  const sftpFeats = [
    ['连接池', '单 SSH 通道多 SFTP 会话'],
    ['断点续传', '大文件分片 + 续传'],
    ['权限隔离', '每个会话独立 root'],
    ['会话保活', 'KeepAlive 心跳检测'],
    ['路径记忆', '最近访问目录缓存'],
  ];
  sftpFeats.forEach((f, i) => {
    const y = 2.3 + i * 0.85;
    s5.addText('▸', { x: 9.35, y, w: 0.3, h: 0.3, fontSize: 12, color: COLORS.accent, fontFace: FONTS.body });
    s5.addText(f[0], { x: 9.65, y, w: 1.5, h: 0.3, fontSize: 11, bold: true, color: COLORS.textPrimary, fontFace: FONTS.title });
    s5.addText(f[1], { x: 9.65, y: y + 0.3, w: 3.2, h: 0.4, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body });
  });
  addPageNumber(s5, 5, TOTAL);

  // ---- Page 6: 渲染层核心能力 ----
  const s6 = pptx.addSlide();
  addDarkBackground(s6);
  addTitleBar(s6, '渲染层核心能力', '10 个 Zustand Store · Monaco · xterm 补全 Addon');
  // 三栏
  const renderFeats = [
    {
      title: '10 个 Zustand Store', color: COLORS.primaryLight,
      items: [
        ['sessionStore', 'SSH 会话列表'],
        ['terminalStore', '终端实例'],
        ['aiStore', 'AI 对话历史'],
        ['fileStore', '文件树/编辑器'],
        ['settingsStore', '配置'],
        ['authStore', '凭据'],
        ['logStore', '日志分析结果'],
        ['riskStore', '风险评分缓存'],
        ['cotStore', 'CoT 证据链'],
        ['uiStore', '主题/布局'],
      ],
    },
    {
      title: 'Monaco Editor', color: COLORS.accent,
      items: [
        ['VS Code 同源', '同 Monaco内核'],
        ['多语言高亮', '80+ 语言'],
        ['多标签页', '动态管理'],
        ['未保存提示', '关闭前确认'],
        ['Diff 视图', '配置对比'],
        ['Minimap', '小地图导航'],
        ['智能提示', '语言服务'],
        ['快捷键', 'VS Code 兼容'],
        ['查找替换', '正则支持'],
        ['多光标', '批量编辑'],
      ],
    },
    {
      title: 'xterm 补全 Addon', color: COLORS.success,
      items: [
        ['ghost text', '灰色提示'],
        ['Trie 前缀', '<1ms 查找'],
        ['Frecency', '7 天半衰期'],
        ['SQLite', '本地持久化'],
        ['2300+ 词条', 'tldr 数据'],
        ['运维专项', '人工兜底'],
        ['延迟', '<10ms'],
        ['离线可用', '零 Token'],
        ['Tab 接受', 'Enter 拒绝'],
        ['历史去重', '频率衰减'],
      ],
    },
  ];
  renderFeats.forEach((f, i) => {
    const x = 0.4 + i * 4.25;
    addCard(s6, x, 1.3, 4.1, 5.5);
    s6.addShape('rect', { x, y: 1.3, w: 4.1, h: 0.5, fill: { color: f.color } });
    s6.addText(f.title, { x, y: 1.35, w: 4.1, h: 0.4, fontSize: 13, bold: true, color: 'FFFFFF', fontFace: FONTS.title, align: 'center' });
    f.items.forEach((it, j) => {
      const y = 1.95 + j * 0.45;
      s6.addText(it[0], { x: x + 0.2, y, w: 1.7, h: 0.35, fontSize: 10, bold: true, color: COLORS.textPrimary, fontFace: FONTS.code });
      s6.addText(it[1], { x: x + 1.9, y, w: 2.1, h: 0.35, fontSize: 9, color: COLORS.textSecondary, fontFace: FONTS.body });
    });
  });
  addPageNumber(s6, 6, TOTAL);

  // ---- Page 7: Python Sidecar 设计 ----
  const s7 = pptx.addSlide();
  addDarkBackground(s7);
  addTitleBar(s7, 'Python Sidecar 设计', '三进程隔离 · stdio JSON-RPC · 端口 7931/7932/7933');
  const sidecars = [
    {
      port: '7931', name: 'SRE', title: 'Site Reliability Engine',
      color: COLORS.error, icon: '🛡️',
      resp: ['风险评估', '高危命令拦截'],
      tech: ['D-S 证据理论', 'PCR5 融合规则', '白名单策略'],
    },
    {
      port: '7932', name: 'Analytics', title: 'Log Analytics Engine',
      color: COLORS.warning, icon: '📊',
      resp: ['日志分析', 'SELinux audit 解析'],
      tech: ['journald 索引', '正则模式匹配', '异常聚类'],
    },
    {
      port: '7933', name: 'Agent', title: 'Decision Agent',
      color: COLORS.success, icon: '🤖',
      resp: ['决策推理', 'PAOR 循环'],
      tech: ['Plan-Act-Observe-Reflect', '9 子 Agent', '降级单步计划'],
    },
  ];
  sidecars.forEach((sc, i) => {
    const x = 0.4 + i * 4.25;
    addCard(s7, x, 1.3, 4.1, 5.5);
    s7.addShape('rect', { x, y: 1.3, w: 4.1, h: 0.7, fill: { color: sc.color } });
    s7.addText(`${sc.icon}  ${sc.name}`, { x, y: 1.35, w: 4.1, h: 0.4, fontSize: 16, bold: true, color: 'FFFFFF', fontFace: FONTS.title, align: 'center' });
    s7.addText(`:${sc.port}`, { x, y: 1.7, w: 4.1, h: 0.3, fontSize: 13, color: 'FFFFFF', fontFace: FONTS.code, align: 'center', bold: true });
    s7.addText(sc.title, { x: x + 0.2, y: 2.15, w: 3.7, h: 0.3, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body, align: 'center', italic: true });
    // 职责
    s7.addText('职责', { x: x + 0.2, y: 2.6, w: 3.7, h: 0.3, fontSize: 11, bold: true, color: sc.color, fontFace: FONTS.title });
    sc.resp.forEach((r, j) => {
      s7.addText(`▸ ${r}`, { x: x + 0.3, y: 2.95 + j * 0.35, w: 3.5, h: 0.3, fontSize: 10, color: COLORS.textPrimary, fontFace: FONTS.body });
    });
    // 技术
    s7.addText('技术实现', { x: x + 0.2, y: 4.0, w: 3.7, h: 0.3, fontSize: 11, bold: true, color: sc.color, fontFace: FONTS.title });
    sc.tech.forEach((t, j) => {
      s7.addText(`▸ ${t}`, { x: x + 0.3, y: 4.35 + j * 0.35, w: 3.5, h: 0.3, fontSize: 10, color: COLORS.textPrimary, fontFace: FONTS.body });
    });
    // 通信
    s7.addShape('rect', { x: x + 0.2, y: 5.6, w: 3.7, h: 0.95, fill: { color: '0F0F12' } });
    s7.addText('通信协议', { x: x + 0.3, y: 5.65, w: 3.5, h: 0.25, fontSize: 9, bold: true, color: COLORS.primaryLight, fontFace: FONTS.title });
    s7.addText('stdio · JSON-RPC 2.0', { x: x + 0.3, y: 5.9, w: 3.5, h: 0.3, fontSize: 10, color: COLORS.textPrimary, fontFace: FONTS.code });
    s7.addText('Main ↔ Sidecar 双向', { x: x + 0.3, y: 6.2, w: 3.5, h: 0.3, fontSize: 9, color: COLORS.textSecondary, fontFace: FONTS.body });
  });
  addPageNumber(s7, 7, TOTAL);

  // ---- Page 8: 数据规模与质量门禁 ----
  const s8 = pptx.addSlide();
  addDarkBackground(s8);
  addTitleBar(s8, '数据规模与质量门禁', '14.8 万行代码 · 1346 测试用例 · 4/5 绿');
  // 顶部 KPI
  addKPI(s8, 0.4, 1.3, 2.4, 1.2, '14.8万', '代码行数');
  addKPI(s8, 2.95, 1.3, 2.4, 1.2, '542', '源文件数', COLORS.primaryLight);
  addKPI(s8, 5.5, 1.3, 2.4, 1.2, '60', '测试文件数', COLORS.accent);
  addKPI(s8, 8.05, 1.3, 2.4, 1.2, '1346', '测试用例数', COLORS.success);
  addKPI(s8, 10.6, 1.3, 2.4, 1.2, '7.25s', '测试通过耗时', COLORS.warning);
  // 五绿门禁表
  addCard(s8, 0.4, 2.75, 12.5, 4.0);
  s8.addText('五绿门禁（编译验证）', { x: 0.6, y: 2.9, w: 12.1, h: 0.4, fontSize: 14, bold: true, color: COLORS.primaryLight, fontFace: FONTS.title });
  const gates = [
    ['typecheck:node', 'Node 端类型检查', 'tsc --noEmit', '✅ 绿', COLORS.success],
    ['typecheck:web', 'Web 端类型检查', 'tsc --noEmit (Vite)', '✅ 绿', COLORS.success],
    ['lint', 'ESLint + Prettier', 'eslint . --max-warnings 0', '✅ 绿', COLORS.success],
    ['test', 'Vitest 单元测试', 'vitest run', '✅ 绿 (7.25s)', COLORS.success],
    ['build:win', 'Electron Forge 构建', 'forge make (Win)', '⏭️ 按惯例跳过', COLORS.warning],
  ];
  // 表头
  s8.addShape('rect', { x: 0.6, y: 3.4, w: 12.1, h: 0.4, fill: { color: COLORS.primary } });
  ['门禁项', '说明', '命令', '状态'].forEach((h, i) => {
    const xs = [0.6, 3.6, 6.6, 10.4];
    const ws = [3.0, 3.0, 3.8, 2.3];
    s8.addText(h, { x: xs[i] + 0.1, y: 3.42, w: ws[i] - 0.2, h: 0.35, fontSize: 11, bold: true, color: 'FFFFFF', fontFace: FONTS.title });
  });
  gates.forEach((g, i) => {
    const y = 3.85 + i * 0.55;
    if (i % 2 === 0) {
      s8.addShape('rect', { x: 0.6, y, w: 12.1, h: 0.5, fill: { color: '1F1F23' } });
    }
    const xs = [0.6, 3.6, 6.6, 10.4];
    const ws = [3.0, 3.0, 3.8, 2.3];
    s8.addText(g[0], { x: xs[0] + 0.1, y: y + 0.05, w: ws[0] - 0.2, h: 0.4, fontSize: 10, color: COLORS.textPrimary, fontFace: FONTS.code, bold: true });
    s8.addText(g[1], { x: xs[1] + 0.1, y: y + 0.05, w: ws[1] - 0.2, h: 0.4, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body });
    s8.addText(g[2], { x: xs[2] + 0.1, y: y + 0.05, w: ws[2] - 0.2, h: 0.4, fontSize: 9, color: COLORS.textSecondary, fontFace: FONTS.code });
    s8.addText(g[3], { x: xs[3] + 0.1, y: y + 0.05, w: ws[3] - 0.2, h: 0.4, fontSize: 10, bold: true, color: g[4], fontFace: FONTS.body });
  });
  addPageNumber(s8, 8, TOTAL);

  // ---- Page 9: v1.0.0 里程碑 ----
  const s9 = pptx.addSlide();
  addDarkBackground(s9);
  addTitleBar(s9, 'v1.0.0 里程碑', 'commit bbf6356 · tag 已推送 origin/master · 最新 commit 9451a20');
  const milestones = [
    ['M1', '终端智能补全 Phase 1', 'Trie + Frecency + SQLite，零 Token 本地补全，延迟 <10ms', '2300+ 词条 + 运维专项兜底', COLORS.success],
    ['M2', 'Electerm SFTP 模块抽取', '从 Electerm 开源项目抽取 SFTP 核心，MIT 协议贡献回社区', '会话复用 + 断点续传', COLORS.accent],
    ['M3', 'Provider logprobs 直采', '5/8 provider 直采 + 3/8 provider 兑底，usedLogprobs 字段透明', 'OpenAI 协议族全覆盖', COLORS.warning],
    ['M4', 'CoT 透明化', '6 源证据权重 UI 可见，D-S + PCR5 公式透明展示', '最终可信度数值化', COLORS.primaryLight],
    ['M5', 'HITL CoPilot 模式', '87.5% 接受率（论文验证），三态权限审批', '主对话与后台 Review 解耦', COLORS.error],
    ['M6', 'PAOR 自主循环', 'Plan-Act-Observe-Reflect，9 子 Agent 编排', 'LLM 不可用降级单步计划', COLORS.accent],
  ];
  milestones.forEach((m, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 0.4 + col * 4.25;
    const y = 1.3 + row * 2.75;
    addCard(s9, x, y, 4.1, 2.55);
    s9.addShape('rect', { x, y, w: 4.1, h: 0.5, fill: { color: m[4] } });
    s9.addText(m[0], { x: x + 0.2, y: y + 0.05, w: 0.8, h: 0.4, fontSize: 16, bold: true, color: 'FFFFFF', fontFace: FONTS.title });
    s9.addText(m[1], { x: x + 0.9, y: y + 0.05, w: 3.1, h: 0.4, fontSize: 12, bold: true, color: 'FFFFFF', fontFace: FONTS.title });
    s9.addText(m[2], { x: x + 0.2, y: y + 0.6, w: 3.7, h: 0.8, fontSize: 10, color: COLORS.textPrimary, fontFace: FONTS.body });
    s9.addText(`▸ ${m[3]}`, { x: x + 0.2, y: y + 1.5, w: 3.7, h: 0.4, fontSize: 10, color: m[4], fontFace: FONTS.body, bold: true });
    s9.addText(`状态：✅ 已交付`, { x: x + 0.2, y: y + 2.05, w: 3.7, h: 0.3, fontSize: 9, color: COLORS.success, fontFace: FONTS.body });
  });
  addPageNumber(s9, 9, TOTAL);

  // ---- Page 10: 技术架构优势总结 ----
  const s10 = pptx.addSlide();
  addDarkBackground(s10);
  addTitleBar(s10, '技术架构优势总结', '本地优先 · Token 透明 · 安全红线 · 可审计');
  const advs = [
    {
      title: '本地优先', icon: '🏠', color: COLORS.success,
      desc: '终端补全、风险评分、日志分析全本地化',
      metrics: [['补全延迟', '<10ms'], ['Token 消耗', '0'], ['离线可用', '✅']],
    },
    {
      title: 'Token 透明', icon: '🔍', color: COLORS.accent,
      desc: '每个 LLM 调用 Token 消耗 UI 可见',
      metrics: [['logprobs 直采', '5/8'], ['兑底方案', '3/8'], ['usedLogprobs', '透明']],
    },
    {
      title: '安全红线', icon: '🛡️', color: COLORS.error,
      desc: '高危命令白名单 + ML 风险评分双轨',
      metrics: [['拦截策略', '双层'], ['审批模式', '三态'], ['审计落盘', '100%']],
    },
    {
      title: '可审计', icon: '📜', color: COLORS.warning,
      desc: 'OpenTelemetry + Langfuse 全链路追踪',
      metrics: [['证据链', '6 源'], ['融合规则', 'PCR5'], ['循环可追踪', 'PAOR']],
    },
  ];
  advs.forEach((a, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.4 + col * 6.45;
    const y = 1.3 + row * 2.85;
    addCard(s10, x, y, 6.25, 2.7);
    s10.addText(a.icon, { x: x + 0.3, y: y + 0.3, w: 1.0, h: 1.0, fontSize: 36, align: 'center', fontFace: FONTS.title });
    s10.addText(a.title, { x: x + 1.4, y: y + 0.3, w: 4.7, h: 0.5, fontSize: 18, bold: true, color: a.color, fontFace: FONTS.title });
    s10.addText(a.desc, { x: x + 1.4, y: y + 0.8, w: 4.7, h: 0.4, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body });
    a.metrics.forEach((m, j) => {
      const mx = x + 0.3 + j * 1.95;
      s10.addShape('rect', { x: mx, y: y + 1.5, w: 1.8, h: 0.95, fill: { color: '0F0F12' } });
      s10.addText(m[0], { x: mx, y: y + 1.55, w: 1.8, h: 0.3, fontSize: 9, color: COLORS.textSecondary, fontFace: FONTS.body, align: 'center' });
      s10.addText(m[1], { x: mx, y: y + 1.85, w: 1.8, h: 0.45, fontSize: 13, bold: true, color: a.color, fontFace: FONTS.title, align: 'center' });
    });
  });
  addPageNumber(s10, 10, TOTAL);

  const out = path.join(__dirname, 'tdsf-ppt-01-product.pptx');
  return pptx.writeFile({ fileName: out }).then(() => out);
}

// ============ PPT-02 Demo 演示流程 ============
function genPPT02() {
  const pptx = new pptxgen();
  pptx.defineLayout({ name: 'TDSF', width: SLIDE_W, height: SLIDE_H });
  pptx.layout = 'TDSF';
  pptx.author = 'TDSF Team';
  pptx.title = 'TDSF Linux Desktop Demo 演示流程';

  const TOTAL = 8;

  // ---- Page 1: 封面 ----
  const s1 = pptx.addSlide();
  addDarkBackground(s1);
  s1.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: 0.3, fill: { color: COLORS.accent } });
  s1.addShape('rect', { x: 1.0, y: 2.3, w: 11.3, h: 2.8, fill: { color: COLORS.bgCard }, line: { color: COLORS.accent, width: 1 } });
  s1.addText('TDSF Linux Desktop Demo', {
    x: 1.0, y: 2.5, w: 11.3, h: 0.9,
    fontSize: 38, bold: true, color: 'FFFFFF', fontFace: FONTS.title, align: 'center',
  });
  s1.addText('演示流程 · 9 步主路径 · 5:00 总时长', {
    x: 1.0, y: 3.4, w: 11.3, h: 0.5,
    fontSize: 20, color: COLORS.accent, fontFace: FONTS.body, align: 'center',
  });
  s1.addText('6 段均分（每段 50s） · 桌面端 1920×1080', {
    x: 1.0, y: 4.0, w: 11.3, h: 0.4,
    fontSize: 14, color: COLORS.textSecondary, fontFace: FONTS.body, align: 'center',
  });
  addKPI(s1, 1.0, 5.5, 2.7, 1.0, '9', '步骤数', COLORS.accent);
  addKPI(s1, 3.9, 5.5, 2.7, 1.0, '5:00', '总时长', COLORS.warning);
  addKPI(s1, 6.8, 5.5, 2.7, 1.0, '6', '演示段', COLORS.primaryLight);
  addKPI(s1, 9.7, 5.5, 2.7, 1.0, '1920×1080', '分辨率', COLORS.success);
  addFooter(s1);

  // ---- Page 2: 9 步主路径概览 ----
  const s2 = pptx.addSlide();
  addDarkBackground(s2);
  addTitleBar(s2, 'Demo 9 步主路径概览', '启动 → 连接 → 命令 → AI → 拦截 → CoT → 日志 → 编辑 → 退出');
  // 表头
  s2.addShape('rect', { x: 0.4, y: 1.3, w: 12.5, h: 0.5, fill: { color: COLORS.primary } });
  const headers = [['#', 0.6], ['步骤', 2.4], ['关键动作', 5.5], ['时长', 1.0], ['阶段', 3.0]];
  let xAcc = 0.4;
  headers.forEach((h) => {
    s2.addText(h[0], { x: xAcc + 0.1, y: 1.35, w: h[1] - 0.2, h: 0.4, fontSize: 11, bold: true, color: 'FFFFFF', fontFace: FONTS.title, align: 'center' });
    xAcc += h[1];
  });
  const steps = [
    ['1', '启动应用', '双击 TDSF.exe → BootPage loading → /workbench', '10s', '启动', COLORS.textMuted],
    ['2', 'SSH 连接', '服务器选择器 → 输入密码 → 连接成功', '15s', '连接', COLORS.primaryLight],
    ['3', '终端命令', 'df -h → Tab 补全 → ghost text → Enter', '25s', '终端', COLORS.accent],
    ['4', 'AI 对话', '@mention → 分析磁盘占用 → AI 返回', '50s', 'AI', COLORS.primaryLight],
    ['5', '高危拦截', 'rm -rf / → 拦截弹窗 → 风险评分 → 拒绝', '50s', '安全', COLORS.error],
    ['6', 'CoT 透明化', '展开 CoT 面板 → 6 源证据 → 0.82', '50s', '决策', COLORS.warning],
    ['7', '日志分析', '/logs → SELinux audit → 拖入分析 → 7932', '50s', '日志', COLORS.success],
    ['8', '文件编辑', 'FileTree → sshd_config → Monaco 编辑', '50s', '编辑', COLORS.accent],
    ['9', '保存退出', 'Ctrl+S → 全部保存 → 关闭确认', '50s', '退出', COLORS.textMuted],
  ];
  steps.forEach((st, i) => {
    const y = 1.85 + i * 0.55;
    if (i % 2 === 0) s2.addShape('rect', { x: 0.4, y, w: 12.5, h: 0.5, fill: { color: '1F1F23' } });
    s2.addText(st[0], { x: 0.5, y: y + 0.05, w: 0.5, h: 0.4, fontSize: 12, bold: true, color: st[5], fontFace: FONTS.title, align: 'center' });
    s2.addText(st[1], { x: 1.0, y: y + 0.05, w: 2.3, h: 0.4, fontSize: 11, bold: true, color: COLORS.textPrimary, fontFace: FONTS.title });
    s2.addText(st[2], { x: 3.4, y: y + 0.05, w: 5.4, h: 0.4, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body });
    s2.addText(st[3], { x: 8.9, y: y + 0.05, w: 1.0, h: 0.4, fontSize: 11, bold: true, color: COLORS.warning, fontFace: FONTS.code, align: 'center' });
    s2.addShape('rect', { x: 9.95, y: y + 0.1, w: 2.85, h: 0.32, fill: { color: st[5] } });
    s2.addText(st[4], { x: 9.95, y: y + 0.12, w: 2.85, h: 0.28, fontSize: 10, bold: true, color: 'FFFFFF', fontFace: FONTS.body, align: 'center' });
  });
  // 合计
  s2.addShape('rect', { x: 0.4, y: 6.85, w: 12.5, h: 0.4, fill: { color: COLORS.primary } });
  s2.addText('合计', { x: 0.5, y: 6.87, w: 2.8, h: 0.36, fontSize: 11, bold: true, color: 'FFFFFF', fontFace: FONTS.title });
  s2.addText('9 步主路径全程演示', { x: 3.4, y: 6.87, w: 5.4, h: 0.36, fontSize: 10, color: 'FFFFFF', fontFace: FONTS.body });
  s2.addText('5:00', { x: 8.9, y: 6.87, w: 1.0, h: 0.36, fontSize: 11, bold: true, color: COLORS.warning, fontFace: FONTS.code, align: 'center' });
  s2.addText('全程', { x: 9.95, y: 6.87, w: 2.85, h: 0.36, fontSize: 10, bold: true, color: 'FFFFFF', fontFace: FONTS.body, align: 'center' });
  addPageNumber(s2, 2, TOTAL);

  // ---- Page 3: 时间预算与设备要求 ----
  const s3 = pptx.addSlide();
  addDarkBackground(s3);
  addTitleBar(s3, '时间预算与设备要求', '5:00 总时长 · 6 段均分 · 桌面端 1920×1080');
  // 左：时间预算
  addCard(s3, 0.4, 1.3, 6.2, 5.5);
  s3.addText('⏱️ 时间预算', { x: 0.6, y: 1.45, w: 5.8, h: 0.4, fontSize: 14, bold: true, color: COLORS.warning, fontFace: FONTS.title });
  const budget = [
    ['启动+连接+命令', '0:00 - 0:50', '50s', '3 步合并', COLORS.textMuted],
    ['AI 对话', '0:50 - 1:40', '50s', '段 2', COLORS.primaryLight],
    ['高危拦截', '1:40 - 2:30', '50s', '段 3', COLORS.error],
    ['CoT 透明化', '2:30 - 3:20', '50s', '段 4', COLORS.warning],
    ['日志分析', '3:20 - 4:10', '50s', '段 5', COLORS.success],
    ['文件编辑+退出', '4:10 - 5:00', '50s', '段 6', COLORS.accent],
  ];
  budget.forEach((b, i) => {
    const y = 1.95 + i * 0.78;
    s3.addShape('rect', { x: 0.6, y, w: 0.1, h: 0.7, fill: { color: b[4] } });
    s3.addText(b[0], { x: 0.8, y, w: 2.5, h: 0.35, fontSize: 11, bold: true, color: COLORS.textPrimary, fontFace: FONTS.title });
    s3.addText(b[1], { x: 0.8, y: y + 0.35, w: 2.5, h: 0.3, fontSize: 9, color: COLORS.textSecondary, fontFace: FONTS.code });
    s3.addText(b[2], { x: 3.4, y, w: 1.4, h: 0.35, fontSize: 14, bold: true, color: b[4], fontFace: FONTS.title, align: 'center' });
    s3.addText(b[3], { x: 4.85, y, w: 1.6, h: 0.35, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body, align: 'center' });
  });
  // 右：设备要求
  addCard(s3, 6.75, 1.3, 6.2, 5.5);
  s3.addText('💻 设备与环境要求', { x: 6.95, y: 1.45, w: 5.8, h: 0.4, fontSize: 14, bold: true, color: COLORS.accent, fontFace: FONTS.title });
  const reqs = [
    ['演示设备', '桌面端 Windows 10/11'],
    ['屏幕分辨率', '1920 × 1080（必填）'],
    ['缩放比例', '100%（避免 UI 错位）'],
    ['TDSF 版本', 'v1.0.0（commit bbf6356）'],
    ['网络要求', '稳定外网（LLM API 必备）'],
    ['Linux 远程 VM', 'Ubuntu 22.04 / CentOS 9'],
    ['SSH 凭据', '预置演示账号 tdsf-demo'],
    ['LLM Provider', '主：deepseek；备：qwen'],
    ['Token 预算', '约 5 万 Token 全程'],
    ['备份方案', '本地 ollama 离线兜底'],
  ];
  reqs.forEach((r, i) => {
    const y = 1.95 + i * 0.48;
    s3.addText('▸', { x: 6.95, y, w: 0.3, h: 0.4, fontSize: 12, color: COLORS.accent, fontFace: FONTS.body });
    s3.addText(r[0], { x: 7.25, y, w: 2.2, h: 0.4, fontSize: 11, bold: true, color: COLORS.textPrimary, fontFace: FONTS.title });
    s3.addText(r[1], { x: 9.5, y, w: 3.3, h: 0.4, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body });
  });
  addPageNumber(s3, 3, TOTAL);

  // ---- Page 4: 步骤 1-3 详细脚本 ----
  const s4 = pptx.addSlide();
  addDarkBackground(s4);
  addTitleBar(s4, '步骤 1-3 详细脚本', '启动 / SSH 连接 / 终端命令 · 合计 50s');
  // 4 列表格
  const colHeaders = ['屏幕内容', '旁白', '交互', '时长'];
  const colWidths = [4.2, 4.4, 2.5, 1.4];
  const colXs = [0.4, 4.6, 9.0, 11.5];
  // 表头
  colHeaders.forEach((h, i) => {
    s4.addShape('rect', { x: colXs[i], y: 1.3, w: colWidths[i], h: 0.45, fill: { color: COLORS.primary } });
    s4.addText(h, { x: colXs[i], y: 1.33, w: colWidths[i], h: 0.4, fontSize: 11, bold: true, color: 'FFFFFF', fontFace: FONTS.title, align: 'center' });
  });
  const detail13 = [
    {
      step: '步骤 1 · 启动应用（10s）',
      color: COLORS.textMuted,
      cells: [
        '双击 TDSF.exe\nBootPage loading 出现\n进度条 0% → 100%\n自动跳转 /workbench',
        '演示开始。\n这是 TDSF Linux Desktop\nv1.0.0 比赛交付版。\n启动加载约 3 秒。',
        '鼠标双击图标\n等待 BootPage 完成\n自动进入工作台',
        '10s',
      ],
    },
    {
      step: '步骤 2 · SSH 连接（15s）',
      color: COLORS.primaryLight,
      cells: [
        '服务器选择器弹出\n列表中选 tdsf-demo\n密码输入框聚焦\n终端显示 ready',
        '现在连接演示服务器\nUbuntu 22.04 远程 VM。\n凭据已预置。\nSSH 通道建立成功。',
        '点击服务器列表\n输入密码（掩码）\nEnter 确认\n终端 ready 提示',
        '15s',
      ],
    },
    {
      step: '步骤 3 · 终端命令（25s）',
      color: COLORS.accent,
      cells: [
        '输入 df -h\nTab 触发补全\n显示 ghost text 建议\nEnter 执行\n输出磁盘占用表',
        '演示智能补全：\n输入 df - 时，\n本地 Trie 给出 -h 建议，\n延迟 <10ms，零 Token。',
        '键入 df -\n按 Tab 接受\n按 Enter 执行\n查看输出',
        '25s',
      ],
    },
  ];
  detail13.forEach((d, i) => {
    const y = 1.85 + i * 1.7;
    s4.addShape('rect', { x: 0.4, y, w: 12.5, h: 0.4, fill: { color: d.color } });
    s4.addText(d.step, { x: 0.5, y, w: 12.3, h: 0.4, fontSize: 12, bold: true, color: 'FFFFFF', fontFace: FONTS.title });
    d.cells.forEach((c, j) => {
      const cy = y + 0.45;
      s4.addShape('rect', { x: colXs[j], y: cy, w: colWidths[j], h: 1.2, fill: { color: '1F1F23' }, line: { color: COLORS.divider, width: 0.3 } });
      s4.addText(c, { x: colXs[j] + 0.1, y: cy + 0.05, w: colWidths[j] - 0.2, h: 1.1, fontSize: 9, color: j === 3 ? COLORS.warning : COLORS.textPrimary, fontFace: j === 3 ? FONTS.code : (j === 0 ? FONTS.code : FONTS.body), bold: j === 3, align: j === 3 ? 'center' : 'left' });
    });
  });
  addPageNumber(s4, 4, TOTAL);

  // ---- Page 5: 步骤 4-6 详细脚本 ----
  const s5 = pptx.addSlide();
  addDarkBackground(s5);
  addTitleBar(s5, '步骤 4-6 详细脚本', 'AI 对话 / 高危拦截 / CoT 透明化 · 每步 50s');
  colHeaders.forEach((h, i) => {
    s5.addShape('rect', { x: colXs[i], y: 1.3, w: colWidths[i], h: 0.45, fill: { color: COLORS.primary } });
    s5.addText(h, { x: colXs[i], y: 1.33, w: colWidths[i], h: 0.4, fontSize: 11, bold: true, color: 'FFFFFF', fontFace: FONTS.title, align: 'center' });
  });
  const detail46 = [
    {
      step: '步骤 4 · AI 对话（50s）',
      color: COLORS.primaryLight,
      cells: [
        '@mention 弹出文件选择\n选中 /var/log/syslog\n输入「分析磁盘占用」\nAI 流式返回分析结果\nToken 计数器更新',
        '演示人机协同：\n@mention 关联 syslog，\n提问磁盘占用分析。\nAI 通过 deepseek 流式返回。\nToken 透明可见。',
        '@ 触发文件选择\n点击 syslog\n输入问题\nEnter 提交\n查看流式响应',
        '50s',
      ],
    },
    {
      step: '步骤 5 · 高危拦截（50s）',
      color: COLORS.error,
      cells: [
        '输入 rm -rf /\n拦截弹窗立即弹出\n显示风险评分 0.92\n6 源证据权重展示\n用户点击「拒绝」',
        '演示安全红线：\nrm -rf / 触发拦截，\nD-S 证据融合给出 0.92 高危分。\n三态审批 ALWAYS/AUTO/NEVER，\n本次选择「拒绝」。',
        '键入 rm -rf /\n等待拦截弹窗\n查看风险评分\n点击拒绝按钮',
        '50s',
      ],
    },
    {
      step: '步骤 6 · CoT 透明化（50s）',
      color: COLORS.warning,
      cells: [
        '展开 CoT 面板\n6 源证据列表显示\n每源权重 0-1.0\n显示 D-S + PCR5 公式\n最终可信度 0.82',
        '演示决策透明：\n展开 CoT 面板，\n6 源证据权重可见，\nD-S + PCR5 融合规则透明展示，\n最终可信度 0.82 数值化。',
        '点击 CoT 展开按钮\n滚动查看证据列表\n查看融合公式\n查看最终可信度',
        '50s',
      ],
    },
  ];
  detail46.forEach((d, i) => {
    const y = 1.85 + i * 1.7;
    s5.addShape('rect', { x: 0.4, y, w: 12.5, h: 0.4, fill: { color: d.color } });
    s5.addText(d.step, { x: 0.5, y, w: 12.3, h: 0.4, fontSize: 12, bold: true, color: 'FFFFFF', fontFace: FONTS.title });
    d.cells.forEach((c, j) => {
      const cy = y + 0.45;
      s5.addShape('rect', { x: colXs[j], y: cy, w: colWidths[j], h: 1.2, fill: { color: '1F1F23' }, line: { color: COLORS.divider, width: 0.3 } });
      s5.addText(c, { x: colXs[j] + 0.1, y: cy + 0.05, w: colWidths[j] - 0.2, h: 1.1, fontSize: 9, color: j === 3 ? COLORS.warning : COLORS.textPrimary, fontFace: j === 3 ? FONTS.code : (j === 0 ? FONTS.code : FONTS.body), bold: j === 3, align: j === 3 ? 'center' : 'left' });
    });
  });
  addPageNumber(s5, 5, TOTAL);

  // ---- Page 6: 步骤 7-9 详细脚本 ----
  const s6 = pptx.addSlide();
  addDarkBackground(s6);
  addTitleBar(s6, '步骤 7-9 详细脚本', '日志分析 / 文件编辑 / 保存退出 · 每步 50s');
  colHeaders.forEach((h, i) => {
    s6.addShape('rect', { x: colXs[i], y: 1.3, w: colWidths[i], h: 0.45, fill: { color: COLORS.primary } });
    s6.addText(h, { x: colXs[i], y: 1.33, w: colWidths[i], h: 0.4, fontSize: 11, bold: true, color: 'FFFFFF', fontFace: FONTS.title, align: 'center' });
  });
  const detail79 = [
    {
      step: '步骤 7 · 日志分析（50s）',
      color: COLORS.success,
      cells: [
        '切换到 /logs 页面\n选择 SELinux audit\n拖入 audit.log 文件\nPython Sidecar :7932\n返回分析报告',
        '演示日志分析：\n切换 /logs 页面，\n拖入 SELinux audit 日志，\nPython Sidecar 7932 端口处理，\n返回 AVC 智能解析报告。',
        '点击 /logs 标签\n选 SELinux 类型\n拖入文件\n等待分析完成',
        '50s',
      ],
    },
    {
      step: '步骤 8 · 文件编辑（50s）',
      color: COLORS.accent,
      cells: [
        'FileTree 展开 /etc/ssh\n双击 sshd_config\nMonaco 编辑器加载\n修改 Port 22 → 2222\n语法高亮 + Minimap',
        '演示文件编辑：\nFileTree 双击 sshd_config，\nMonaco 编辑器加载（VS Code 同源），\n修改 SSH 端口示例。\n语法高亮 + Minimap 导航。',
        '展开 FileTree\n双击 sshd_config\n定位 Port 行\n修改端口号',
        '50s',
      ],
    },
    {
      step: '步骤 9 · 保存退出（50s）',
      color: COLORS.textMuted,
      cells: [
        'Ctrl+S 触发保存\n显示「全部保存」按钮\n点击全部保存\n关闭未保存确认 Modal\n应用退出',
        '演示保存退出：\nCtrl+S 保存当前文件，\n点击「全部保存」批量保存，\n关闭时未保存文件弹出确认 Modal，\n用户确认后应用退出。',
        '按 Ctrl+S\n点击全部保存\n关闭应用\n处理确认 Modal',
        '50s',
      ],
    },
  ];
  detail79.forEach((d, i) => {
    const y = 1.85 + i * 1.7;
    s6.addShape('rect', { x: 0.4, y, w: 12.5, h: 0.4, fill: { color: d.color } });
    s6.addText(d.step, { x: 0.5, y, w: 12.3, h: 0.4, fontSize: 12, bold: true, color: 'FFFFFF', fontFace: FONTS.title });
    d.cells.forEach((c, j) => {
      const cy = y + 0.45;
      s6.addShape('rect', { x: colXs[j], y: cy, w: colWidths[j], h: 1.2, fill: { color: '1F1F23' }, line: { color: COLORS.divider, width: 0.3 } });
      s6.addText(c, { x: colXs[j] + 0.1, y: cy + 0.05, w: colWidths[j] - 0.2, h: 1.1, fontSize: 9, color: j === 3 ? COLORS.warning : COLORS.textPrimary, fontFace: j === 3 ? FONTS.code : (j === 0 ? FONTS.code : FONTS.body), bold: j === 3, align: j === 3 ? 'center' : 'left' });
    });
  });
  addPageNumber(s6, 6, TOTAL);

  // ---- Page 7: 关键交互点演示 ----
  const s7 = pptx.addSlide();
  addDarkBackground(s7);
  addTitleBar(s7, '关键交互点演示', '鼠标划选 @注入 · HITL 三态审批 · Token 透明化面板');
  const interactions = [
    {
      title: '鼠标划选 → @命令注入', color: COLORS.primaryLight, icon: '🖱️',
      desc: '终端输出文本划选后弹出 @mention 浮窗',
      steps: ['1. 鼠标划选终端输出片段', '2. 浮窗显示「@注入到 AI」', '3. 点击后自动关联到 AI 输入框', '4. 后续提问自动引用该上下文'],
    },
    {
      title: 'HITL 三态审批', color: COLORS.error, icon: '🛡️',
      desc: 'ALWAYS / AUTO / NEVER 三态权限审批',
      steps: ['1. 高危命令触发审批弹窗', '2. ALWAYS：本次允许并记忆', '3. AUTO：本次自动允许', '4. NEVER：本次拒绝并记忆'],
    },
    {
      title: 'Token 透明化面板', color: COLORS.warning, icon: '🔍',
      desc: '每个 LLM 调用 Token 消耗实时可见',
      steps: ['1. AI 对话右侧展开 Token 面板', '2. 显示 prompt/completion tokens', '3. 显示 usedLogprobs 字段', '4. 累计 Token + 估算成本'],
    },
  ];
  interactions.forEach((it, i) => {
    const x = 0.4 + i * 4.25;
    addCard(s7, x, 1.3, 4.1, 5.5);
    s7.addShape('rect', { x, y: 1.3, w: 4.1, h: 0.7, fill: { color: it.color } });
    s7.addText(it.icon, { x: x + 0.2, y: 1.4, w: 0.6, h: 0.5, fontSize: 24, color: 'FFFFFF', align: 'center' });
    s7.addText(it.title, { x: x + 0.85, y: 1.4, w: 3.1, h: 0.5, fontSize: 12, bold: true, color: 'FFFFFF', fontFace: FONTS.title });
    s7.addText(it.desc, { x: x + 0.2, y: 2.15, w: 3.7, h: 0.6, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body, italic: true });
    it.steps.forEach((st, j) => {
      const y = 2.85 + j * 0.85;
      s7.addShape('ellipse', { x: x + 0.25, y: y + 0.08, w: 0.2, h: 0.2, fill: { color: it.color } });
      s7.addText(st, { x: x + 0.55, y, w: 3.3, h: 0.7, fontSize: 10, color: COLORS.textPrimary, fontFace: FONTS.body });
    });
  });
  addPageNumber(s7, 7, TOTAL);

  // ---- Page 8: 应急预案 ----
  const s8 = pptx.addSlide();
  addDarkBackground(s8);
  addTitleBar(s8, '应急预案', '网络断连 / 进程崩溃 / 超时 / LLM 不可用');
  const emergencies = [
    {
      risk: '网络断连', level: '高', color: COLORS.error, icon: '📡',
      trigger: 'LLM API 调用超时 / SSH 断开',
      plan: '切换到本地 ollama 离线兜底；SSH 自动重连 3 次',
      backup: '备机已预置离线模式演示视频',
    },
    {
      risk: '进程崩溃', level: '高', color: COLORS.error, icon: '💥',
      trigger: 'Main / Renderer / Sidecar 任一崩溃',
      plan: 'Electron 自动重启；Sidecar 进程隔离互不影响',
      backup: '崩溃日志自动落盘 ~/.tdsf/logs/crash-*.json',
    },
    {
      risk: 'AI 响应超时', level: '中', color: COLORS.warning, icon: '⏰',
      trigger: 'LLM 30s 无响应',
      plan: '降级到单步计划模式；切换备用 Provider',
      backup: '预录 CoT 静态展示备播',
    },
    {
      risk: 'LLM 不可用', level: '中', color: COLORS.warning, icon: '🚫',
      trigger: '所有 Provider 不可用',
      plan: 'PAOR 降级为单步计划；本地补全仍可用',
      backup: '演示补全 + 拦截 + 日志分析 3 个非 LLM 功能',
    },
    {
      risk: '终端卡死', level: '低', color: COLORS.success, icon: '🖥️',
      trigger: 'SSH 通道阻塞',
      plan: '终端 Reset 按钮；新建会话',
      backup: '保留终端历史日志可回看',
    },
    {
      risk: '文件保存失败', level: '低', color: COLORS.success, icon: '💾',
      trigger: '权限不足 / 磁盘满',
      plan: '提示具体错误；自动备份到 ~/.tdsf/backup',
      backup: '本地副本可手动恢复',
    },
  ];
  emergencies.forEach((e, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 0.4 + col * 4.25;
    const y = 1.3 + row * 2.85;
    addCard(s8, x, y, 4.1, 2.7);
    s8.addShape('rect', { x, y, w: 4.1, h: 0.5, fill: { color: e.color } });
    s8.addText(e.icon, { x: x + 0.2, y: y + 0.05, w: 0.6, h: 0.4, fontSize: 18, align: 'center' });
    s8.addText(e.risk, { x: x + 0.85, y: y + 0.05, w: 2.5, h: 0.4, fontSize: 14, bold: true, color: 'FFFFFF', fontFace: FONTS.title });
    s8.addText(`风险等级：${e.level}`, { x: x + 3.0, y: y + 0.05, w: 1.0, h: 0.4, fontSize: 10, bold: true, color: 'FFFFFF', fontFace: FONTS.body, align: 'right' });
    s8.addText('触发条件', { x: x + 0.2, y: y + 0.6, w: 3.7, h: 0.25, fontSize: 9, bold: true, color: COLORS.primaryLight, fontFace: FONTS.title });
    s8.addText(e.trigger, { x: x + 0.2, y: y + 0.85, w: 3.7, h: 0.4, fontSize: 9, color: COLORS.textPrimary, fontFace: FONTS.body });
    s8.addText('应对方案', { x: x + 0.2, y: y + 1.3, w: 3.7, h: 0.25, fontSize: 9, bold: true, color: COLORS.primaryLight, fontFace: FONTS.title });
    s8.addText(e.plan, { x: x + 0.2, y: y + 1.55, w: 3.7, h: 0.5, fontSize: 9, color: COLORS.textPrimary, fontFace: FONTS.body });
    s8.addText('备选方案', { x: x + 0.2, y: y + 2.05, w: 3.7, h: 0.25, fontSize: 9, bold: true, color: COLORS.primaryLight, fontFace: FONTS.title });
    s8.addText(e.backup, { x: x + 0.2, y: y + 2.3, w: 3.7, h: 0.35, fontSize: 9, color: COLORS.textSecondary, fontFace: FONTS.body, italic: true });
  });
  addPageNumber(s8, 8, TOTAL);

  const out = path.join(__dirname, 'tdsf-ppt-02-demo.pptx');
  return pptx.writeFile({ fileName: out }).then(() => out);
}

// ============ PPT-03 创新点 + 学术亮点 ============
function genPPT03() {
  const pptx = new pptxgen();
  pptx.defineLayout({ name: 'TDSF', width: SLIDE_W, height: SLIDE_H });
  pptx.layout = 'TDSF';
  pptx.author = 'TDSF Team';
  pptx.title = 'TDSF Linux Desktop 创新点与学术亮点';

  const TOTAL = 8;

  // ---- Page 1: 封面 ----
  const s1 = pptx.addSlide();
  addDarkBackground(s1);
  s1.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: 0.3, fill: { color: COLORS.warning } });
  s1.addShape('rect', { x: 1.0, y: 2.3, w: 11.3, h: 2.8, fill: { color: COLORS.bgCard }, line: { color: COLORS.warning, width: 1 } });
  s1.addText('TDSF Linux Desktop', { x: 1.0, y: 2.5, w: 11.3, h: 0.9, fontSize: 38, bold: true, color: 'FFFFFF', fontFace: FONTS.title, align: 'center' });
  s1.addText('创新点与学术亮点', { x: 1.0, y: 3.4, w: 11.3, h: 0.5, fontSize: 22, color: COLORS.warning, fontFace: FONTS.body, align: 'center' });
  s1.addText('5 大创新 · 论文支撑 · 行业对标', { x: 1.0, y: 4.0, w: 11.3, h: 0.4, fontSize: 14, color: COLORS.textSecondary, fontFace: FONTS.body, align: 'center' });
  addKPI(s1, 1.0, 5.5, 2.7, 1.0, '5', '创新点', COLORS.warning);
  addKPI(s1, 3.9, 5.5, 2.7, 1.0, '87.5%', 'HITL 接受率', COLORS.success);
  addKPI(s1, 6.8, 5.5, 2.7, 1.0, '<10ms', '补全延迟', COLORS.accent);
  addKPI(s1, 9.7, 5.5, 2.7, 1.0, '5/8', 'logprobs 直采', COLORS.primaryLight);
  addFooter(s1);

  // ---- Page 2: 创新点 1 - 可信度算法 ----
  const s2 = pptx.addSlide();
  addDarkBackground(s2);
  addTitleBar(s2, '创新点 ①：可信度算法', 'D-S 证据理论 + PCR5 融合规则 · 论文支撑');
  // 左：算法说明
  addCard(s2, 0.4, 1.3, 6.2, 5.5);
  s2.addText('📐 算法理论', { x: 0.6, y: 1.45, w: 5.8, h: 0.4, fontSize: 14, bold: true, color: COLORS.warning, fontFace: FONTS.title });
  const algoPoints = [
    ['Dempster-Shafer', '证据理论框架', '允许「不确定」与「冲突」建模'],
    ['PCR5', 'Proportional Conflict Redistribution', '冲突按比例分配给各假设'],
    ['6 源证据', '多源信息融合', '风险评分、白名单、历史、ML...'],
    ['最终可信度', '0-1.0 数值化', 'UI 透明展示决策依据'],
  ];
  algoPoints.forEach((p, i) => {
    const y = 1.95 + i * 1.1;
    s2.addShape('rect', { x: 0.6, y, w: 0.08, h: 1.0, fill: { color: COLORS.warning } });
    s2.addText(p[0], { x: 0.8, y, w: 5.5, h: 0.35, fontSize: 12, bold: true, color: COLORS.textPrimary, fontFace: FONTS.title });
    s2.addText(p[1], { x: 0.8, y: y + 0.35, w: 5.5, h: 0.3, fontSize: 10, color: COLORS.warning, fontFace: FONTS.code });
    s2.addText(p[2], { x: 0.8, y: y + 0.65, w: 5.5, h: 0.3, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body });
  });
  // 论文引用
  s2.addShape('rect', { x: 0.6, y: 6.4, w: 5.8, h: 0.35, fill: { color: '0F0F12' } });
  s2.addText('📚 论文引用：Smets 2007 / Martin & Osswald 2007', { x: 0.7, y: 6.42, w: 5.6, h: 0.3, fontSize: 9, color: COLORS.primaryLight, fontFace: FONTS.body, italic: true });
  // 右：6 源证据权重示例
  addCard(s2, 6.75, 1.3, 6.2, 5.5);
  s2.addText('⚖️ 6 源证据权重示例（rm -rf / 案例）', { x: 6.95, y: 1.45, w: 5.8, h: 0.4, fontSize: 13, bold: true, color: COLORS.warning, fontFace: FONTS.title });
  const evidences = [
    ['白名单策略', 0.95, COLORS.error],
    ['命令模式 ML', 0.88, COLORS.error],
    ['历史执行频率', 0.72, COLORS.warning],
    ['用户权限等级', 0.65, COLORS.warning],
    ['目标路径敏感', 0.92, COLORS.error],
    ['时段风险评估', 0.45, COLORS.success],
  ];
  evidences.forEach((e, i) => {
    const y = 1.95 + i * 0.65;
    s2.addText(e[0], { x: 6.95, y, w: 2.0, h: 0.4, fontSize: 11, bold: true, color: COLORS.textPrimary, fontFace: FONTS.body });
    // 进度条
    s2.addShape('rect', { x: 9.0, y: y + 0.1, w: 3.5, h: 0.2, fill: { color: '0F0F12' } });
    s2.addShape('rect', { x: 9.0, y: y + 0.1, w: 3.5 * e[1], h: 0.2, fill: { color: e[2] } });
    s2.addText(e[1].toFixed(2), { x: 12.6, y, w: 0.4, h: 0.4, fontSize: 11, bold: true, color: e[2], fontFace: FONTS.code, align: 'right' });
  });
  // 最终结果
  s2.addShape('rect', { x: 6.95, y: 6.0, w: 5.8, h: 0.75, fill: { color: COLORS.error } });
  s2.addText('D-S + PCR5 融合 → 最终可信度', { x: 7.05, y: 6.05, w: 3.8, h: 0.65, fontSize: 11, bold: true, color: 'FFFFFF', fontFace: FONTS.title });
  s2.addText('0.92', { x: 11.0, y: 6.0, w: 1.7, h: 0.75, fontSize: 28, bold: true, color: 'FFFFFF', fontFace: FONTS.title, align: 'center' });
  addPageNumber(s2, 2, TOTAL);

  // ---- Page 3: 创新点 2 - HITL CoPilot ----
  const s3 = pptx.addSlide();
  addDarkBackground(s3);
  addTitleBar(s3, '创新点 ②：HITL CoPilot 模式', '87.5% 接受率 > 25% 完全自主 · 论文验证');
  // 顶部对比
  addCard(s3, 0.4, 1.3, 6.2, 2.3);
  s3.addText('AutoResearchClaw 论文数据', { x: 0.6, y: 1.45, w: 5.8, h: 0.4, fontSize: 13, bold: true, color: COLORS.success, fontFace: FONTS.title });
  // 87.5% 大数字
  s3.addText('87.5%', { x: 0.6, y: 1.95, w: 2.8, h: 1.2, fontSize: 56, bold: true, color: COLORS.success, fontFace: FONTS.title, align: 'center' });
  s3.addText('HITL CoPilot 接受率', { x: 3.4, y: 2.05, w: 3.0, h: 0.4, fontSize: 11, bold: true, color: COLORS.textPrimary, fontFace: FONTS.body });
  s3.addText('人工介入协同，决策可审计', { x: 3.4, y: 2.4, w: 3.0, h: 0.4, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body });
  s3.addText('人保留最终决策权', { x: 3.4, y: 2.7, w: 3.0, h: 0.4, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body });
  s3.addText('vs', { x: 3.4, y: 2.95, w: 0.5, h: 0.3, fontSize: 12, color: COLORS.textMuted, fontFace: FONTS.title, align: 'center' });
  s3.addText('25%', { x: 4.0, y: 2.95, w: 1.0, h: 0.4, fontSize: 18, bold: true, color: COLORS.error, fontFace: FONTS.title });
  s3.addText('完全自主', { x: 5.0, y: 2.95, w: 1.4, h: 0.4, fontSize: 10, color: COLORS.error, fontFace: FONTS.body });
  // 右：三态权限
  addCard(s3, 6.75, 1.3, 6.2, 2.3);
  s3.addText('🛡️ 三态权限审批', { x: 6.95, y: 1.45, w: 5.8, h: 0.4, fontSize: 13, bold: true, color: COLORS.error, fontFace: FONTS.title });
  const triStates = [
    ['ALWAYS', '本次允许 + 永久记忆', COLORS.success],
    ['AUTO', '本次自动允许（一次性）', COLORS.warning],
    ['NEVER', '本次拒绝 + 永久拒绝', COLORS.error],
  ];
  triStates.forEach((t, i) => {
    const x = 6.95 + i * 1.95;
    s3.addShape('rect', { x, y: 1.95, w: 1.8, h: 1.5, fill: { color: '0F0F12' }, line: { color: t[2], width: 1.5 } });
    s3.addText(t[0], { x, y: 2.05, w: 1.8, h: 0.5, fontSize: 14, bold: true, color: t[2], fontFace: FONTS.title, align: 'center' });
    s3.addText(t[1], { x, y: 2.6, w: 1.8, h: 0.8, fontSize: 9, color: COLORS.textSecondary, fontFace: FONTS.body, align: 'center' });
  });
  // 下：架构说明
  addCard(s3, 0.4, 3.75, 12.5, 3.05);
  s3.addText('🔀 主对话与后台 Review 解耦架构', { x: 0.6, y: 3.9, w: 12.1, h: 0.4, fontSize: 14, bold: true, color: COLORS.primaryLight, fontFace: FONTS.title });
  // 流程图
  const flowSteps = [
    ['用户输入', '主对话流', '立即响应', COLORS.primaryLight],
    ['AI 生成建议', '后台 Review', '异步审计', COLORS.warning],
    ['HITL 审批', '三态权限', '记录决策', COLORS.error],
    ['执行 + 落盘', '审计日志', '可追溯', COLORS.success],
  ];
  flowSteps.forEach((f, i) => {
    const x = 0.6 + i * 3.15;
    s3.addShape('rect', { x, y: 4.5, w: 2.95, h: 1.4, fill: { color: '0F0F12' }, line: { color: f[3], width: 1 } });
    s3.addText(f[0], { x, y: 4.55, w: 2.95, h: 0.4, fontSize: 12, bold: true, color: f[3], fontFace: FONTS.title, align: 'center' });
    s3.addText(f[1], { x, y: 4.95, w: 2.95, h: 0.3, fontSize: 10, color: COLORS.textPrimary, fontFace: FONTS.body, align: 'center' });
    s3.addText(f[2], { x, y: 5.25, w: 2.95, h: 0.3, fontSize: 9, color: COLORS.textSecondary, fontFace: FONTS.body, align: 'center' });
    s3.addText(`步骤 ${i + 1}`, { x, y: 5.55, w: 2.95, h: 0.3, fontSize: 9, color: f[3], fontFace: FONTS.code, align: 'center', italic: true });
    if (i < 3) {
      s3.addShape('rightArrow', { x: x + 3.0, y: 5.1, w: 0.15, h: 0.2, fill: { color: COLORS.primaryLight } });
    }
  });
  // 底部说明
  s3.addText('💡 解耦价值：主对话不阻塞，后台审计可异步深入分析，证据链完整保留', { x: 0.6, y: 6.2, w: 12.1, h: 0.4, fontSize: 11, color: COLORS.success, fontFace: FONTS.body, italic: true });
  addPageNumber(s3, 3, TOTAL);

  // ---- Page 4: 创新点 3 - 零 Token 本地补全 ----
  const s4 = pptx.addSlide();
  addDarkBackground(s4);
  addTitleBar(s4, '创新点 ③：零 Token 本地补全', 'Trie + Frecency + SQLite · 延迟 <10ms · 离线可用');
  // 左：技术架构
  addCard(s4, 0.4, 1.3, 6.2, 5.5);
  s4.addText('⚙️ 技术架构', { x: 0.6, y: 1.45, w: 5.8, h: 0.4, fontSize: 14, bold: true, color: COLORS.accent, fontFace: FONTS.title });
  const techs = [
    ['Trie 前缀树', 'O(L) 查找复杂度', 'L 为前缀长度，<1ms 完成'],
    ['Frecency 评分', '7 天半衰期', '频率 × 时间衰减，越新越优先'],
    ['SQLite 持久化', '本地嵌入式', '零依赖，跨进程共享'],
    ['ghost text UI', 'xterm.js Addon', '灰色提示文本，Tab 接受'],
  ];
  techs.forEach((t, i) => {
    const y = 1.95 + i * 1.05;
    s4.addShape('rect', { x: 0.6, y, w: 0.08, h: 0.95, fill: { color: COLORS.accent } });
    s4.addText(t[0], { x: 0.8, y, w: 5.5, h: 0.35, fontSize: 12, bold: true, color: COLORS.textPrimary, fontFace: FONTS.title });
    s4.addText(t[1], { x: 0.8, y: y + 0.35, w: 5.5, h: 0.3, fontSize: 10, color: COLORS.accent, fontFace: FONTS.code });
    s4.addText(t[2], { x: 0.8, y: y + 0.65, w: 5.5, h: 0.3, fontSize: 9, color: COLORS.textSecondary, fontFace: FONTS.body });
  });
  // 右：数据源 + 性能
  addCard(s4, 6.75, 1.3, 6.2, 5.5);
  s4.addText('📊 数据源与性能', { x: 6.95, y: 1.45, w: 5.8, h: 0.4, fontSize: 14, bold: true, color: COLORS.accent, fontFace: FONTS.title });
  // 数据源
  s4.addText('数据源', { x: 6.95, y: 1.95, w: 5.8, h: 0.3, fontSize: 11, bold: true, color: COLORS.primaryLight, fontFace: FONTS.title });
  const sources = [
    ['jaywcjlove/linux-command', '2300+ 词条', 'MIT 协议'],
    ['tldr-pages/tldr', '社区维护', 'MIT 协议'],
    ['运维专项人工兜底', '50+ 词条', '自研'],
  ];
  sources.forEach((s, i) => {
    const y = 2.3 + i * 0.45;
    s4.addText(`▸ ${s[0]}`, { x: 6.95, y, w: 3.3, h: 0.4, fontSize: 10, color: COLORS.textPrimary, fontFace: FONTS.body });
    s4.addText(s[1], { x: 10.3, y, w: 1.5, h: 0.4, fontSize: 10, color: COLORS.warning, fontFace: FONTS.code, bold: true });
    s4.addText(s[2], { x: 11.8, y, w: 1.1, h: 0.4, fontSize: 9, color: COLORS.success, fontFace: FONTS.body, align: 'right' });
  });
  // 性能指标
  s4.addText('性能指标', { x: 6.95, y: 3.85, w: 5.8, h: 0.3, fontSize: 11, bold: true, color: COLORS.primaryLight, fontFace: FONTS.title });
  const perfs = [
    ['查找延迟', '<10ms', COLORS.success],
    ['Token 消耗', '0', COLORS.success],
    ['离线可用', '✅', COLORS.success],
    ['首次加载', '~50ms', COLORS.warning],
    ['内存占用', '<5MB', COLORS.warning],
    ['持久化', 'SQLite', COLORS.accent],
  ];
  perfs.forEach((p, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 6.95 + col * 2.9;
    const y = 4.2 + row * 0.7;
    s4.addShape('rect', { x, y, w: 2.7, h: 0.6, fill: { color: '0F0F12' } });
    s4.addText(p[0], { x, y: y + 0.05, w: 1.6, h: 0.5, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body });
    s4.addText(p[1], { x: x + 1.6, y: y + 0.05, w: 1.0, h: 0.5, fontSize: 14, bold: true, color: p[2], fontFace: FONTS.code, align: 'center' });
  });
  // 总结
  s4.addShape('rect', { x: 6.95, y: 6.4, w: 5.8, h: 0.35, fill: { color: COLORS.accent } });
  s4.addText('💡 完全本地化，无任何网络请求，比赛现场网络不稳亦可用', { x: 7.05, y: 6.42, w: 5.6, h: 0.3, fontSize: 9, color: 'FFFFFF', fontFace: FONTS.body, italic: true });
  addPageNumber(s4, 4, TOTAL);

  // ---- Page 5: 创新点 4 - logprobs 直采 ----
  const s5 = pptx.addSlide();
  addDarkBackground(s5);
  addTitleBar(s5, '创新点 ④：多 Provider logprobs 直采', '5/8 直采 + 3/8 兑底 · usedLogprobs 字段透明');
  // 上：直采
  addCard(s5, 0.4, 1.3, 6.2, 5.5);
  s5.addText('✅ 5/8 Provider 直采', { x: 0.6, y: 1.45, w: 5.8, h: 0.4, fontSize: 14, bold: true, color: COLORS.success, fontFace: FONTS.title });
  s5.addText('OpenAI 协议族原生支持', { x: 0.6, y: 1.85, w: 5.8, h: 0.3, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body, italic: true });
  const direct = [
    ['openai-compatible', '通用 OpenAI 兼容接口', '✅ 原生 logprobs'],
    ['deepseek', '主用 Provider', '✅ 原生 logprobs'],
    ['qwen', '阿里通义千问', '✅ 原生 logprobs'],
    ['volcengine-ark', '火山方舟', '✅ 原生 logprobs'],
    ['ollama', '本地推理（兜底）', '✅ 原生 logprobs'],
  ];
  direct.forEach((d, i) => {
    const y = 2.25 + i * 0.85;
    s5.addShape('rect', { x: 0.6, y, w: 5.8, h: 0.75, fill: { color: '0F2A1A' } });
    s5.addShape('ellipse', { x: 0.7, y: y + 0.27, w: 0.2, h: 0.2, fill: { color: COLORS.success } });
    s5.addText(d[0], { x: 1.0, y: y + 0.05, w: 2.4, h: 0.35, fontSize: 11, bold: true, color: COLORS.textPrimary, fontFace: FONTS.code });
    s5.addText(d[1], { x: 1.0, y: y + 0.4, w: 3.5, h: 0.3, fontSize: 9, color: COLORS.textSecondary, fontFace: FONTS.body });
    s5.addText(d[2], { x: 3.5, y: y + 0.05, w: 2.8, h: 0.35, fontSize: 10, bold: true, color: COLORS.success, fontFace: FONTS.body, align: 'right' });
  });
  // 下：兑底
  addCard(s5, 6.75, 1.3, 6.2, 5.5);
  s5.addText('⚠️ 3/8 Provider 兑底', { x: 6.95, y: 1.45, w: 5.8, h: 0.4, fontSize: 14, bold: true, color: COLORS.warning, fontFace: FONTS.title });
  s5.addText('非 OpenAI 协议族，需兑底方案', { x: 6.95, y: 1.85, w: 5.8, h: 0.3, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body, italic: true });
  const fallback = [
    ['anthropic', 'Claude 系列', 'thinking-block 兑底'],
    ['google', 'Gemini 系列', 'text-fallback 兑底'],
    ['claude-sdk', 'Claude SDK 直连', 'thinking-block 兑底'],
  ];
  fallback.forEach((d, i) => {
    const y = 2.25 + i * 0.85;
    s5.addShape('rect', { x: 6.95, y, w: 5.8, h: 0.75, fill: { color: '2A1F0F' } });
    s5.addShape('ellipse', { x: 7.05, y: y + 0.27, w: 0.2, h: 0.2, fill: { color: COLORS.warning } });
    s5.addText(d[0], { x: 7.35, y: y + 0.05, w: 2.4, h: 0.35, fontSize: 11, bold: true, color: COLORS.textPrimary, fontFace: FONTS.code });
    s5.addText(d[1], { x: 7.35, y: y + 0.4, w: 3.5, h: 0.3, fontSize: 9, color: COLORS.textSecondary, fontFace: FONTS.body });
    s5.addText(d[2], { x: 9.85, y: y + 0.05, w: 2.8, h: 0.35, fontSize: 10, bold: true, color: COLORS.warning, fontFace: FONTS.body, align: 'right' });
  });
  // usedLogprobs 字段
  s5.addShape('rect', { x: 6.95, y: 5.0, w: 5.8, h: 1.6, fill: { color: '0F0F12' }, line: { color: COLORS.primaryLight, width: 1 } });
  s5.addText('usedLogprobs 字段透明标记', { x: 7.05, y: 5.1, w: 5.6, h: 0.4, fontSize: 12, bold: true, color: COLORS.primaryLight, fontFace: FONTS.title });
  s5.addText('{', { x: 7.05, y: 5.5, w: 5.6, h: 0.3, fontSize: 10, color: COLORS.success, fontFace: FONTS.code });
  s5.addText('  "usedLogprobs": true,  // 直采', { x: 7.2, y: 5.75, w: 5.5, h: 0.25, fontSize: 9, color: COLORS.textPrimary, fontFace: FONTS.code });
  s5.addText('  "usedLogprobs": false   // 兑底', { x: 7.2, y: 5.95, w: 5.5, h: 0.25, fontSize: 9, color: COLORS.textPrimary, fontFace: FONTS.code });
  s5.addText('}', { x: 7.05, y: 6.15, w: 5.6, h: 0.3, fontSize: 10, color: COLORS.success, fontFace: FONTS.code });
  s5.addText('💡 UI 可见，用户知情「这是直采还是兑底」', { x: 6.95, y: 6.5, w: 5.8, h: 0.25, fontSize: 9, color: COLORS.accent, fontFace: FONTS.body, italic: true });
  addPageNumber(s5, 5, TOTAL);

  // ---- Page 6: 创新点 5 - PAOR 自主循环 ----
  const s6 = pptx.addSlide();
  addDarkBackground(s6);
  addTitleBar(s6, '创新点 ⑤：PAOR 自主循环', 'Plan-Act-Observe-Reflect · 9 子 Agent · 可降级');
  // 中央：PAOR 循环
  const centerX = 4.0;
  const centerY = 3.5;
  const radius = 1.5;
  const phases = [
    { name: 'Plan', desc: '计划阶段', color: COLORS.primaryLight, angle: 0 },
    { name: 'Act', desc: '执行阶段', color: COLORS.accent, angle: 90 },
    { name: 'Observe', desc: '观察阶段', color: COLORS.warning, angle: 180 },
    { name: 'Reflect', desc: '反思阶段', color: COLORS.success, angle: 270 },
  ];
  // 中央圆
  s6.addShape('ellipse', { x: centerX - 0.8, y: centerY - 0.4, w: 1.6, h: 0.8, fill: { color: COLORS.primary }, line: { color: COLORS.primaryLight, width: 2 } });
  s6.addText('PAOR', { x: centerX - 0.8, y: centerY - 0.35, w: 1.6, h: 0.8, fontSize: 18, bold: true, color: 'FFFFFF', fontFace: FONTS.title, align: 'center', valign: 'middle' });
  // 4 阶段
  phases.forEach((p) => {
    const rad = (p.angle * Math.PI) / 180;
    const px = centerX + radius * Math.cos(rad);
    const py = centerY + radius * Math.sin(rad);
    s6.addShape('ellipse', { x: px - 0.6, y: py - 0.35, w: 1.2, h: 0.7, fill: { color: p.color }, line: { color: 'FFFFFF', width: 1 } });
    s6.addText(p.name, { x: px - 0.6, y: py - 0.3, w: 1.2, h: 0.4, fontSize: 12, bold: true, color: 'FFFFFF', fontFace: FONTS.title, align: 'center' });
    s6.addText(p.desc, { x: px - 0.6, y: py + 0.05, w: 1.2, h: 0.3, fontSize: 8, color: 'FFFFFF', fontFace: FONTS.body, align: 'center' });
  });
  // 左下：9 子 Agent
  addCard(s6, 0.4, 5.3, 6.2, 1.5);
  s6.addText('🤖 9 个子 Agent', { x: 0.6, y: 5.4, w: 5.8, h: 0.35, fontSize: 12, bold: true, color: COLORS.primaryLight, fontFace: FONTS.title });
  s6.addText('Supervisor 编排，分工协作：', { x: 0.6, y: 5.75, w: 5.8, h: 0.3, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body });
  const subAgents = ['Planner', 'Executor', 'Observer', 'Reflector', 'Critic', 'Memory', 'Tool', 'Safety', 'Audit'];
  subAgents.forEach((a, i) => {
    const col = i % 5;
    const row = Math.floor(i / 5);
    const x = 0.6 + col * 1.18;
    const y = 6.1 + row * 0.35;
    s6.addShape('rect', { x, y, w: 1.1, h: 0.3, fill: { color: COLORS.primary } });
    s6.addText(a, { x, y: y + 0.02, w: 1.1, h: 0.26, fontSize: 9, bold: true, color: 'FFFFFF', fontFace: FONTS.code, align: 'center' });
  });
  // 右：降级与可追踪
  addCard(s6, 6.75, 1.3, 6.2, 5.5);
  s6.addText('🛡️ 降级与可追踪', { x: 6.95, y: 1.45, w: 5.8, h: 0.4, fontSize: 14, bold: true, color: COLORS.warning, fontFace: FONTS.title });
  // 降级链
  s6.addText('LLM 不可用降级链', { x: 6.95, y: 1.95, w: 5.8, h: 0.3, fontSize: 11, bold: true, color: COLORS.primaryLight, fontFace: FONTS.title });
  const degradeChain = [
    ['PAOR 自主循环', '正常状态', COLORS.success],
    ['→ 单步计划模式', 'LLM 部分不可用', COLORS.warning],
    ['→ 规则匹配兜底', 'LLM 完全不可用', COLORS.error],
  ];
  degradeChain.forEach((d, i) => {
    const y = 2.3 + i * 0.55;
    s6.addShape('rect', { x: 6.95, y, w: 5.8, h: 0.5, fill: { color: '0F0F12' } });
    s6.addShape('rect', { x: 6.95, y, w: 0.1, h: 0.5, fill: { color: d[2] } });
    s6.addText(d[0], { x: 7.15, y: y + 0.05, w: 3.5, h: 0.4, fontSize: 11, bold: true, color: COLORS.textPrimary, fontFace: FONTS.code });
    s6.addText(d[1], { x: 10.7, y: y + 0.05, w: 2.0, h: 0.4, fontSize: 10, color: d[2], fontFace: FONTS.body, align: 'right' });
  });
  // 可追踪
  s6.addText('循环审计可追踪', { x: 6.95, y: 4.15, w: 5.8, h: 0.3, fontSize: 11, bold: true, color: COLORS.primaryLight, fontFace: FONTS.title });
  const trackPoints = [
    ['每步落盘', '审计日志 ~/.tdsf/audit/paor-*.jsonl'],
    ['Plan/Act 链路', '可回放完整决策路径'],
    ['Reflect 反思', '失败原因结构化记录'],
    ['Tool 调用', '入参/出参/耗时全保留'],
    ['Memory 持久化', '跨会话上下文不丢失'],
  ];
  trackPoints.forEach((t, i) => {
    const y = 4.5 + i * 0.42;
    s6.addText('▸', { x: 6.95, y, w: 0.3, h: 0.35, fontSize: 11, color: COLORS.success, fontFace: FONTS.body });
    s6.addText(t[0], { x: 7.25, y, w: 1.8, h: 0.35, fontSize: 10, bold: true, color: COLORS.textPrimary, fontFace: FONTS.title });
    s6.addText(t[1], { x: 9.1, y, w: 3.6, h: 0.35, fontSize: 9, color: COLORS.textSecondary, fontFace: FONTS.code });
  });
  addPageNumber(s6, 6, TOTAL);

  // ---- Page 7: 学术亮点汇总 ----
  const s7 = pptx.addSlide();
  addDarkBackground(s7);
  addTitleBar(s7, '学术亮点汇总', '6 源证据 + 公式透明 · Token 可见 · OpenTelemetry 可观测');
  const high = [
    {
      title: '6 源证据权重 + 公式透明化', icon: '⚖️', color: COLORS.warning,
      points: ['D-S + PCR5 融合规则完整展示', '每源权重 0-1.0 可见', '最终可信度数值化（如 0.82）', '决策依据完全可追溯'],
    },
    {
      title: 'Token 消耗 UI 可见', icon: '🔍', color: COLORS.accent,
      points: ['每次 LLM 调用实时显示 Token', 'prompt/completion 分别计数', '累计 Token + 估算成本', 'Grok Build 数据丑闻反面教材'],
    },
    {
      title: 'OpenTelemetry + Langfuse 可观测性', icon: '📈', color: COLORS.success,
      points: ['全链路 trace 追踪', '每个 IPC 调用 span 化', 'Sidecar 进程 metric 上报', 'Langfuse 可视化看板'],
    },
    {
      title: '决策可追踪', icon: '📜', color: COLORS.primaryLight,
      points: ['PAOR 每步落盘', 'HITL 审批日志保留', '风险评分证据链完整', '失败可回放重放'],
    },
  ];
  high.forEach((h, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.4 + col * 6.45;
    const y = 1.3 + row * 2.85;
    addCard(s7, x, y, 6.25, 2.7);
    s7.addShape('rect', { x, y, w: 6.25, h: 0.5, fill: { color: h.color } });
    s7.addText(h.icon, { x: x + 0.2, y: y + 0.05, w: 0.5, h: 0.4, fontSize: 18, align: 'center' });
    s7.addText(h.title, { x: x + 0.8, y: y + 0.05, w: 5.3, h: 0.4, fontSize: 13, bold: true, color: 'FFFFFF', fontFace: FONTS.title });
    h.points.forEach((p, j) => {
      s7.addText(`▸ ${p}`, { x: x + 0.3, y: y + 0.65 + j * 0.45, w: 5.7, h: 0.4, fontSize: 10, color: COLORS.textPrimary, fontFace: FONTS.body });
    });
  });
  addPageNumber(s7, 7, TOTAL);

  // ---- Page 8: 行业对标 ----
  const s8 = pptx.addSlide();
  addDarkBackground(s8);
  addTitleBar(s8, '行业对标', 'vs Grok Build / AgentScope / Hermes · TDSF 优势矩阵');
  // 对标表
  addCard(s8, 0.4, 1.3, 12.5, 5.5);
  s8.addText('TDSF 优势矩阵', { x: 0.6, y: 1.45, w: 12.1, h: 0.4, fontSize: 14, bold: true, color: COLORS.warning, fontFace: FONTS.title });
  // 表头
  s8.addShape('rect', { x: 0.6, y: 1.95, w: 12.1, h: 0.5, fill: { color: COLORS.primary } });
  const cmpHeaders = [['对比维度', 2.5], ['Grok Build', 2.4], ['AgentScope', 2.4], ['Hermes', 2.4], ['TDSF', 2.4]];
  let xAcc = 0.6;
  cmpHeaders.forEach((h) => {
    s8.addText(h[0], { x: xAcc + 0.1, y: 2.0, w: h[1] - 0.2, h: 0.4, fontSize: 11, bold: true, color: 'FFFFFF', fontFace: FONTS.title, align: 'center' });
    xAcc += h[1];
  });
  const cmpRows = [
    ['数据透明', '❌ 数据丑闻', '⚠️ 部分', '⚠️ 部分', '✅ 全透明', COLORS.success],
    ['权限模型', '❌ 无', '⚠️ 简单', '✅ 后台 Review', '✅ 三态审批', COLORS.success],
    ['后台审计', '❌ 无', '⚠️ 日志', '✅ 异步', '✅ 主后台解耦', COLORS.success],
    ['Token 可见', '❌ 隐藏', '⚠️ 部分', '❌ 无', '✅ UI 实时', COLORS.success],
    ['可信度算法', '❌ 无', '❌ 无', '⚠️ 启发式', '✅ D-S+PCR5 论文', COLORS.success],
    ['离线可用', '❌ 否', '❌ 否', '❌ 否', '✅ 补全+评分+日志', COLORS.success],
    ['LLM 容错', '❌ 单点', '⚠️ 部分', '⚠️ 部分', '✅ 8 Provider', COLORS.success],
    ['可观测性', '❌ 弱', '⚠️ 日志', '⚠️ 部分', '✅ OTel+Langfuse', COLORS.success],
  ];
  cmpRows.forEach((r, i) => {
    const y = 2.5 + i * 0.5;
    if (i % 2 === 0) s8.addShape('rect', { x: 0.6, y, w: 12.1, h: 0.45, fill: { color: '1F1F23' } });
    let xAcc = 0.6;
    r.slice(0, 5).forEach((cell, j) => {
      const isLast = j === 4;
      s8.addText(cell, { x: xAcc + 0.1, y: y + 0.05, w: cmpHeaders[j][1] - 0.2, h: 0.35, fontSize: 10, bold: isLast, color: isLast ? r[5] : COLORS.textPrimary, fontFace: isLast ? FONTS.title : FONTS.body, align: 'center' });
      xAcc += cmpHeaders[j][1];
    });
  });
  // 底部总结
  s8.addShape('rect', { x: 0.6, y: 6.55, w: 12.1, h: 0.4, fill: { color: COLORS.success } });
  s8.addText('🏆 TDSF 8 维度全部领先，论文 + 工程双支撑', { x: 0.7, y: 6.57, w: 11.9, h: 0.36, fontSize: 12, bold: true, color: 'FFFFFF', fontFace: FONTS.title, align: 'center' });
  addPageNumber(s8, 8, TOTAL);

  const out = path.join(__dirname, 'tdsf-ppt-03-innovation.pptx');
  return pptx.writeFile({ fileName: out }).then(() => out);
}

// ============ PPT-04 开源贡献与复用清单 ============
function genPPT04() {
  const pptx = new pptxgen();
  pptx.defineLayout({ name: 'TDSF', width: SLIDE_W, height: SLIDE_H });
  pptx.layout = 'TDSF';
  pptx.author = 'TDSF Team';
  pptx.title = 'TDSF Linux Desktop 开源贡献与复用清单';

  const TOTAL = 8;

  // ---- Page 1: 封面 ----
  const s1 = pptx.addSlide();
  addDarkBackground(s1);
  s1.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: 0.3, fill: { color: COLORS.success } });
  s1.addShape('rect', { x: 1.0, y: 2.3, w: 11.3, h: 2.8, fill: { color: COLORS.bgCard }, line: { color: COLORS.success, width: 1 } });
  s1.addText('TDSF Linux Desktop', { x: 1.0, y: 2.5, w: 11.3, h: 0.9, fontSize: 38, bold: true, color: 'FFFFFF', fontFace: FONTS.title, align: 'center' });
  s1.addText('开源贡献与复用清单', { x: 1.0, y: 3.4, w: 11.3, h: 0.5, fontSize: 22, color: COLORS.success, fontFace: FONTS.body, align: 'center' });
  s1.addText('18 项复用 · 5 项贡献 · 全量源码分析', { x: 1.0, y: 4.0, w: 11.3, h: 0.4, fontSize: 14, color: COLORS.textSecondary, fontFace: FONTS.body, align: 'center' });
  addKPI(s1, 1.0, 5.5, 2.7, 1.0, '18', '复用项', COLORS.accent);
  addKPI(s1, 3.9, 5.5, 2.7, 1.0, '5', '贡献回社区', COLORS.success);
  addKPI(s1, 6.8, 5.5, 2.7, 1.0, '6', '领域覆盖', COLORS.primaryLight);
  addKPI(s1, 9.7, 5.5, 2.7, 1.0, '10', '安全清单项', COLORS.warning);
  addFooter(s1);

  // ---- Page 2: 18 项开源复用清单 ----
  const s2 = pptx.addSlide();
  addDarkBackground(s2);
  addTitleBar(s2, '18 项开源复用清单', '按 License 分类 · 覆盖 6 大领域');
  // License 分布
  addCard(s2, 0.4, 1.3, 12.5, 1.0);
  s2.addText('License 分布', { x: 0.6, y: 1.4, w: 2.0, h: 0.3, fontSize: 11, bold: true, color: COLORS.primaryLight, fontFace: FONTS.title });
  const licenses = [
    ['MIT', 12, COLORS.success],
    ['Apache-2.0', 3, COLORS.warning],
    ['BSD', 2, COLORS.accent],
    ['ISC', 1, COLORS.primaryLight],
  ];
  licenses.forEach((l, i) => {
    const x = 2.7 + i * 2.6;
    s2.addShape('rect', { x, y: 1.4, w: 2.4, h: 0.7, fill: { color: '0F0F12' } });
    s2.addText(l[0], { x, y: 1.45, w: 1.4, h: 0.6, fontSize: 12, bold: true, color: l[2], fontFace: FONTS.code });
    s2.addText(`${l[1]} 项`, { x: x + 1.4, y: 1.45, w: 1.0, h: 0.6, fontSize: 16, bold: true, color: l[2], fontFace: FONTS.title, align: 'right' });
  });
  // 详细表格
  addCard(s2, 0.4, 2.5, 12.5, 4.3);
  // 表头
  s2.addShape('rect', { x: 0.6, y: 2.6, w: 12.1, h: 0.4, fill: { color: COLORS.primary } });
  const tblHeaders = [['#', 0.5], ['项目', 3.0], ['License', 1.5], ['领域', 1.8], ['用途', 5.3]];
  let xAcc = 0.6;
  tblHeaders.forEach((h) => {
    s2.addText(h[0], { x: xAcc + 0.05, y: 2.62, w: h[1] - 0.1, h: 0.36, fontSize: 10, bold: true, color: 'FFFFFF', fontFace: FONTS.title, align: 'center' });
    xAcc += h[1];
  });
  const reuseItems = [
    ['1', 'xterm.js', 'MIT', 'Terminal', '终端核心渲染'],
    ['2', 'Monaco Editor', 'MIT', 'Editor', '代码编辑器'],
    ['3', 'Electerm', 'MIT', 'SSH', 'SFTP 模块抽取'],
    ['4', 'React', 'MIT', 'UI', '组件框架'],
    ['5', 'TypeScript', 'Apache-2.0', 'Lang', '类型系统'],
    ['6', 'Zustand', 'MIT', 'State', '状态管理'],
    ['7', 'Tailwind CSS', 'MIT', 'Style', '样式框架'],
    ['8', 'Electron', 'MIT', 'Desktop', '桌面框架'],
    ['9', 'Vite', 'MIT', 'Build', '构建工具'],
    ['10', 'Vitest', 'MIT', 'Test', '测试框架'],
    ['11', 'ESLint', 'MIT', 'Lint', '代码检查'],
    ['12', 'OpenTelemetry', 'Apache-2.0', 'Observe', '链路追踪'],
    ['13', 'Langfuse', 'MIT', 'Observe', 'LLM 可观测'],
    ['14', 'tldr-pages', 'MIT', 'Knowledge', '命令词条'],
    ['15', 'jaywcjlove/cmd', 'MIT', 'Knowledge', '中文命令字典'],
    ['16', 'pyzmq', 'BSD', 'IPC', 'Python 通信'],
    ['17', 'cryptography', 'Apache-2.0', 'Crypto', '加密库'],
    ['18', 'is-wsl', 'MIT', 'Util', 'WSL 检测'],
  ];
  reuseItems.forEach((r, i) => {
    const y = 3.05 + i * 0.205;
    if (i % 2 === 0) s2.addShape('rect', { x: 0.6, y, w: 12.1, h: 0.18, fill: { color: '1F1F23' } });
    let xAcc = 0.6;
    const cells = [r[0], r[1], r[2], r[3], r[4]];
    const widths = [0.5, 3.0, 1.5, 1.8, 5.3];
    cells.forEach((c, j) => {
      let color = COLORS.textPrimary;
      let fontFace = FONTS.body;
      if (j === 0) { color = COLORS.textMuted; fontFace = FONTS.code; }
      else if (j === 1) { color = COLORS.textPrimary; fontFace = FONTS.code; }
      else if (j === 2) {
        if (c === 'MIT') color = COLORS.success;
        else if (c === 'Apache-2.0') color = COLORS.warning;
        else if (c === 'BSD') color = COLORS.accent;
        else color = COLORS.primaryLight;
        fontFace = FONTS.code;
      }
      else if (j === 3) color = COLORS.primaryLight;
      s2.addText(c, { x: xAcc + 0.05, y: y + 0.01, w: widths[j] - 0.1, h: 0.18, fontSize: 8, color, fontFace, bold: j === 1 || j === 2, align: j === 0 || j === 2 || j === 3 ? 'center' : 'left' });
      xAcc += widths[j];
    });
  });
  addPageNumber(s2, 2, TOTAL);

  // ---- Page 3: 5 项 MIT 协议贡献回社区 ----
  const s3 = pptx.addSlide();
  addDarkBackground(s3);
  addTitleBar(s3, '5 项 MIT 协议贡献回社区', '自研模块开源 · MIT 协议 · 可独立使用');
  const contribs = [
    {
      no: '①', name: 'McpLifecycleHardened', title: '5 阶段状态机',
      color: COLORS.warning,
      desc: 'MCP server 生命周期管理，5 阶段状态机 + 3 类错误恢复 + 健康检查 PID 验证',
      tech: ['Init/Starting/Ready/Stopping/Stopped', '健康检查 + PID 验证', '3 类错误恢复策略'],
    },
    {
      no: '②', name: 'Trie+Frecency Engine', title: '终端补全引擎',
      color: COLORS.accent,
      desc: 'Trie 前缀查找 + Frecency 半衰期评分 + SQLite 持久化，延迟 <10ms',
      tech: ['O(L) 查找复杂度', '7 天 Frecency 衰减', '零 Token 本地化'],
    },
    {
      no: '③', name: 'D-S+PCR5 Impl', title: '可信度算法实现',
      color: COLORS.error,
      desc: 'Dempster-Shafer 证据理论 + PCR5 融合规则的工程化实现，6 源证据融合',
      tech: ['论文：Smets 2007 / Martin 2007', '6 源证据融合', 'PCR5 冲突分配'],
    },
    {
      no: '④', name: 'Electerm SFTP Module', title: 'SFTP 模块抽取',
      color: COLORS.primaryLight,
      desc: '从 Electerm 开源项目抽取 SFTP 核心，会话复用 + 断点续传',
      tech: ['连接池复用', '大文件分片续传', 'MIT 协议开源'],
    },
    {
      no: '⑤', name: 'PAOR Framework', title: 'PAOR 自主循环框架',
      color: COLORS.success,
      desc: 'Plan-Act-Observe-Reflect 自主循环框架，9 子 Agent 编排',
      tech: ['9 子 Agent 协作', '降级单步计划', '循环审计可追踪'],
    },
  ];
  contribs.forEach((c, i) => {
    const x = 0.4 + (i % 3) * 4.25;
    const y = 1.3 + Math.floor(i / 3) * 2.85;
    addCard(s3, x, y, 4.1, 2.7);
    s3.addShape('rect', { x, y, w: 4.1, h: 0.5, fill: { color: c.color } });
    s3.addText(c.no, { x: x + 0.2, y: y + 0.05, w: 0.5, h: 0.4, fontSize: 18, bold: true, color: 'FFFFFF', fontFace: FONTS.title });
    s3.addText(c.name, { x: x + 0.75, y: y + 0.05, w: 3.2, h: 0.4, fontSize: 11, bold: true, color: 'FFFFFF', fontFace: FONTS.title });
    s3.addText(c.title, { x: x + 0.2, y: y + 0.6, w: 3.7, h: 0.3, fontSize: 10, color: c.color, fontFace: FONTS.code, italic: true });
    s3.addText(c.desc, { x: x + 0.2, y: y + 0.95, w: 3.7, h: 0.85, fontSize: 9, color: COLORS.textSecondary, fontFace: FONTS.body });
    s3.addText('技术要点', { x: x + 0.2, y: y + 1.85, w: 3.7, h: 0.25, fontSize: 9, bold: true, color: COLORS.primaryLight, fontFace: FONTS.title });
    c.tech.forEach((t, j) => {
      s3.addText(`▸ ${t}`, { x: x + 0.2, y: y + 2.1 + j * 0.2, w: 3.7, h: 0.2, fontSize: 8, color: COLORS.textPrimary, fontFace: FONTS.body });
    });
  });
  addPageNumber(s3, 3, TOTAL);

  // ---- Page 4: 自研开源模块详解 ----
  const s4 = pptx.addSlide();
  addDarkBackground(s4);
  addTitleBar(s4, '自研开源模块详解', 'McpLifecycleHardened · 5 阶段 + 3 类恢复 + 健康检查');
  // 阶段流程图
  addCard(s4, 0.4, 1.3, 12.5, 2.3);
  s4.addText('🔄 5 阶段状态机流转', { x: 0.6, y: 1.4, w: 12.1, h: 0.35, fontSize: 13, bold: true, color: COLORS.warning, fontFace: FONTS.title });
  const states = [
    ['Init', '初始化资源', COLORS.textMuted],
    ['Starting', '启动 server', COLORS.warning],
    ['Ready', '健康检查通过', COLORS.success],
    ['Stopping', '优雅停止', COLORS.warning],
    ['Stopped', 'PID 验证退出', COLORS.textMuted],
  ];
  states.forEach((st, i) => {
    const x = 0.6 + i * 2.45;
    s4.addShape('rect', { x, y: 1.85, w: 2.2, h: 1.1, fill: { color: '0F0F12' }, line: { color: st[2], width: 1.5 } });
    s4.addText(st[0], { x, y: 1.95, w: 2.2, h: 0.4, fontSize: 14, bold: true, color: st[2], fontFace: FONTS.title, align: 'center' });
    s4.addText(st[1], { x, y: 2.4, w: 2.2, h: 0.4, fontSize: 9, color: COLORS.textSecondary, fontFace: FONTS.body, align: 'center' });
    s4.addText(`阶段 ${i + 1}`, { x, y: 2.7, w: 2.2, h: 0.25, fontSize: 8, color: st[2], fontFace: FONTS.code, align: 'center', italic: true });
    if (i < 4) {
      s4.addShape('rightArrow', { x: x + 2.25, y: 2.3, w: 0.15, h: 0.2, fill: { color: COLORS.primaryLight } });
    }
  });
  s4.addText('状态机：单向流转，禁止跨阶段跳跃', { x: 0.6, y: 3.05, w: 12.1, h: 0.3, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body, italic: true });
  // 3 类错误恢复
  addCard(s4, 0.4, 3.75, 6.2, 3.05);
  s4.addText('🛠️ 3 类错误恢复策略', { x: 0.6, y: 3.85, w: 5.8, h: 0.35, fontSize: 13, bold: true, color: COLORS.error, fontFace: FONTS.title });
  const recoveries = [
    ['启动失败', 'Init→Starting 失败', '回滚资源 + 退出', COLORS.error],
    ['健康检查失败', 'Ready 状态失活', '自动 Stopping 重启', COLORS.warning],
    ['停止超时', 'Stopping 超时', 'SIGKILL + PID 验证', COLORS.error],
  ];
  recoveries.forEach((r, i) => {
    const y = 4.3 + i * 0.8;
    s4.addShape('rect', { x: 0.6, y, w: 0.1, h: 0.7, fill: { color: r[3] } });
    s4.addText(r[0], { x: 0.8, y, w: 1.8, h: 0.3, fontSize: 11, bold: true, color: COLORS.textPrimary, fontFace: FONTS.title });
    s4.addText(r[1], { x: 0.8, y: y + 0.3, w: 2.8, h: 0.25, fontSize: 9, color: COLORS.textSecondary, fontFace: FONTS.code });
    s4.addText(r[2], { x: 3.7, y: y + 0.05, w: 2.6, h: 0.6, fontSize: 10, color: r[3], fontFace: FONTS.body, align: 'center', bold: true });
  });
  // 健康检查
  addCard(s4, 6.75, 3.75, 6.2, 3.05);
  s4.addText('❤️ 健康检查 PID 验证', { x: 6.95, y: 3.85, w: 5.8, h: 0.35, fontSize: 13, bold: true, color: COLORS.success, fontFace: FONTS.title });
  const healthChecks = [
    ['检查频率', '每 5s 一次心跳'],
    ['PID 校验', 'process.kill(pid, 0)'],
    ['端口探测', '7931/7932/7933 全部响应'],
    ['响应超时', '>3s 标记失活'],
    ['失活处理', '触发 Stopping 流程'],
    ['PID 复用防护', '启动时记录 start time'],
  ];
  healthChecks.forEach((h, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 6.95 + col * 2.95;
    const y = 4.3 + row * 0.7;
    s4.addShape('rect', { x, y, w: 2.8, h: 0.6, fill: { color: '0F0F12' } });
    s4.addText(h[0], { x, y: y + 0.05, w: 1.2, h: 0.5, fontSize: 9, color: COLORS.textSecondary, fontFace: FONTS.body });
    s4.addText(h[1], { x: x + 1.2, y: y + 0.05, w: 1.6, h: 0.5, fontSize: 10, bold: true, color: COLORS.success, fontFace: FONTS.code, align: 'center' });
  });
  addPageNumber(s4, 4, TOTAL);

  // ---- Page 5: 安全红线 F1 ----
  const s5 = pptx.addSlide();
  addDarkBackground(s5);
  addTitleBar(s5, '安全红线（F1）· Stars<1k 必查', '10 项清单 · 防供应链投毒');
  // 红色警示条
  s5.addShape('rect', { x: 0.4, y: 1.3, w: 12.5, h: 0.4, fill: { color: COLORS.error } });
  s5.addText('⚠️ 任何 Stars<1k 的依赖，引入前必须完成 10 项检查', { x: 0.5, y: 1.32, w: 12.3, h: 0.36, fontSize: 11, bold: true, color: 'FFFFFF', fontFace: FONTS.title, align: 'center' });
  // 10 项清单 2 列 × 5 行
  const checklist = [
    ['1. License 合规', 'MIT/Apache-2.0/BSD/ISC', COLORS.success],
    ['2. 首次 commit 时间', '>1 年前更可信', COLORS.warning],
    ['3. 最近 commit 时间', '<6 个月内活跃', COLORS.warning],
    ['4. README 质量', '完整文档 + 示例', COLORS.primaryLight],
    ['5. Issue 活跃度', '响应率 >50%', COLORS.primaryLight],
    ['6. preinstall 脚本', '禁用，白名单审查', COLORS.error],
    ['7. 隐藏二进制', 'scan binary files', COLORS.error],
    ['8. C2 外连', '网络抓包验证', COLORS.error],
    ['9. 异常 tag 数', '<10 个稳定版本', COLORS.warning],
    ['10. 可疑维护者', '邮箱/组织核验', COLORS.warning],
  ];
  checklist.forEach((c, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.4 + col * 6.45;
    const y = 1.85 + row * 0.95;
    addCard(s5, x, y, 6.25, 0.85);
    s5.addShape('ellipse', { x: x + 0.15, y: y + 0.3, w: 0.25, h: 0.25, fill: { color: c[2] } });
    s5.addText(c[0], { x: x + 0.5, y: y + 0.1, w: 3.0, h: 0.35, fontSize: 11, bold: true, color: COLORS.textPrimary, fontFace: FONTS.title });
    s5.addText(c[1], { x: x + 0.5, y: y + 0.45, w: 5.5, h: 0.3, fontSize: 9, color: c[2], fontFace: FONTS.body });
    s5.addText(`✅ 已检查`, { x: x + 5.0, y: y + 0.2, w: 1.2, h: 0.4, fontSize: 9, bold: true, color: COLORS.success, fontFace: FONTS.body, align: 'right' });
  });
  // 底部说明
  s5.addShape('rect', { x: 0.4, y: 6.75, w: 12.5, h: 0.35, fill: { color: '2A1F0F' } });
  s5.addText('📋 TDSF v1.0.0 所有 18 项依赖均通过 10 项检查 · 检查记录归档 opensource-reference/audit/', { x: 0.5, y: 6.77, w: 12.3, h: 0.32, fontSize: 10, color: COLORS.warning, fontFace: FONTS.body, italic: true });
  addPageNumber(s5, 5, TOTAL);

  // ---- Page 6: 复用方式分级 ----
  const s6 = pptx.addSlide();
  addDarkBackground(s6);
  addTitleBar(s6, '复用方式分级', '直接复用 / 适配复用 / 参考实现 · 三级策略');
  const levels = [
    {
      title: '直接复用', color: COLORS.success, icon: '📦',
      desc: 'npm install 直接安装，无修改',
      examples: [
        ['React', '组件框架'],
        ['Zustand', '状态管理'],
        ['Tailwind CSS', '样式'],
        ['Vite', '构建'],
        ['Vitest', '测试'],
        ['ESLint', 'lint'],
        ['xterm.js', '终端'],
        ['Monaco Editor', '编辑器'],
      ],
      count: '12 项',
    },
    {
      title: '适配复用', color: COLORS.warning, icon: '🔧',
      desc: 'fork + 改造，保留协议',
      examples: [
        ['Electerm', 'SFTP 模块抽取'],
        ['tldr-pages', '词条筛选'],
        ['jaywcjlove/cmd', '中文化'],
      ],
      count: '3 项',
    },
    {
      title: '参考实现', color: COLORS.primaryLight, icon: '📖',
      desc: 'read source，自研实现',
      examples: [
        ['McpLifecycleHardened', '参考生命周期模式'],
        ['Trie+Frecency', '参考算法论文'],
        ['D-S+PCR5', '参考论文实现'],
      ],
      count: '3 项',
    },
  ];
  levels.forEach((l, i) => {
    const x = 0.4 + i * 4.25;
    addCard(s6, x, 1.3, 4.1, 5.5);
    s6.addShape('rect', { x, y: 1.3, w: 4.1, h: 0.7, fill: { color: l.color } });
    s6.addText(l.icon, { x: x + 0.2, y: 1.4, w: 0.6, h: 0.5, fontSize: 24, align: 'center' });
    s6.addText(l.title, { x: x + 0.85, y: 1.4, w: 2.4, h: 0.4, fontSize: 14, bold: true, color: 'FFFFFF', fontFace: FONTS.title });
    s6.addText(l.count, { x: x + 3.0, y: 1.45, w: 1.0, h: 0.4, fontSize: 12, bold: true, color: 'FFFFFF', fontFace: FONTS.code, align: 'right' });
    s6.addText(l.desc, { x: x + 0.85, y: 1.7, w: 3.0, h: 0.25, fontSize: 9, color: 'FFFFFF', fontFace: FONTS.body });
    // 列表
    l.examples.forEach((e, j) => {
      const y = 2.2 + j * 0.55;
      s6.addShape('rect', { x: x + 0.2, y, w: 3.7, h: 0.5, fill: { color: '0F0F12' } });
      s6.addText(e[0], { x: x + 0.3, y: y + 0.05, w: 2.3, h: 0.4, fontSize: 10, bold: true, color: COLORS.textPrimary, fontFace: FONTS.code });
      s6.addText(e[1], { x: x + 2.6, y: y + 0.05, w: 1.2, h: 0.4, fontSize: 9, color: l.color, fontFace: FONTS.body, align: 'right' });
    });
  });
  addPageNumber(s6, 6, TOTAL);

  // ---- Page 7: 风险控制 ----
  const s7 = pptx.addSlide();
  addDarkBackground(s7);
  addTitleBar(s7, '风险控制', 'License 黑名单 · 敏感文件 redact · 网络请求透明');
  const risks = [
    {
      title: 'License 黑名单', color: COLORS.error, icon: '🚫',
      desc: '严格审查，参赛项目避免 AGPL 传染',
      items: [
        ['octoagent', 'SSPL 严格审查'],
        ['Daytona', 'AGPL 严格审查'],
        ['其他 AGPL/SSPL', '一律不引入'],
        ['商用 License', '禁止使用'],
      ],
    },
    {
      title: '敏感文件 redact', color: COLORS.warning, icon: '🔒',
      desc: '发送前自动脱敏，防泄漏',
      items: [
        ['.env', '环境变量脱敏'],
        ['.ssh/', '私钥目录脱敏'],
        ['*_key', '密钥文件脱敏'],
        ['*.pem', '证书文件脱敏'],
      ],
    },
    {
      title: '网络请求透明', color: COLORS.success, icon: '🌐',
      desc: '所有网络请求 UI 可见，用户知情',
      items: [
        ['Provider 调用', 'Token 计数实时'],
        ['遥测上报', '可一键关闭'],
        ['Sidecar 通信', '本地 stdio'],
        ['崩溃日志', '本地落盘'],
      ],
    },
  ];
  risks.forEach((r, i) => {
    const x = 0.4 + i * 4.25;
    addCard(s7, x, 1.3, 4.1, 5.5);
    s7.addShape('rect', { x, y: 1.3, w: 4.1, h: 0.7, fill: { color: r.color } });
    s7.addText(r.icon, { x: x + 0.2, y: 1.4, w: 0.6, h: 0.5, fontSize: 24, align: 'center' });
    s7.addText(r.title, { x: x + 0.85, y: 1.4, w: 3.1, h: 0.4, fontSize: 12, bold: true, color: 'FFFFFF', fontFace: FONTS.title });
    s7.addText(r.desc, { x: x + 0.2, y: 2.15, w: 3.7, h: 0.6, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body, italic: true });
    r.items.forEach((it, j) => {
      const y = 2.85 + j * 0.85;
      s7.addShape('rect', { x: x + 0.2, y, w: 3.7, h: 0.75, fill: { color: '0F0F12' } });
      s7.addText(it[0], { x: x + 0.3, y: y + 0.05, w: 3.5, h: 0.35, fontSize: 11, bold: true, color: r.color, fontFace: FONTS.code });
      s7.addText(it[1], { x: x + 0.3, y: y + 0.4, w: 3.5, h: 0.3, fontSize: 9, color: COLORS.textPrimary, fontFace: FONTS.body });
    });
  });
  addPageNumber(s7, 7, TOTAL);

  // ---- Page 8: 开源精神总结 ----
  const s8 = pptx.addSlide();
  addDarkBackground(s8);
  addTitleBar(s8, '开源精神总结', '不重复造轮子 · 全量源码分析 · 5 项贡献回社区');
  const spirits = [
    {
      no: '01', title: '不重复造轮子', color: COLORS.primaryLight, icon: '♻️',
      desc: 'A8 硬约束，凡有成熟 MIT 库一律复用',
      detail: '18 项依赖均严格审查 License 后引入，自研仅 5 项核心模块',
    },
    {
      no: '02', title: '全量源码分析', color: COLORS.accent, icon: '🔍',
      desc: 'git clone 到 opensource-reference/',
      detail: '所有依赖源码本地留存，可追溯、可审计、可二次开发',
    },
    {
      no: '03', title: '复用清单维护', color: COLORS.warning, icon: '📋',
      desc: '维护进开发文档',
      detail: '每项依赖：版本/License/用途/检查记录全归档，每次升级同步更新',
    },
    {
      no: '04', title: '5 项贡献回社区', color: COLORS.success, icon: '🎁',
      desc: 'MIT 协议开源，可独立使用',
      detail: 'McpLifecycleHardened / Trie+Frecency / D-S+PCR5 / Electerm SFTP / PAOR',
    },
  ];
  spirits.forEach((sp, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.4 + col * 6.45;
    const y = 1.3 + row * 2.85;
    addCard(s8, x, y, 6.25, 2.7);
    s8.addShape('rect', { x, y, w: 1.5, h: 2.7, fill: { color: sp.color } });
    s8.addText(sp.no, { x, y: y + 0.3, w: 1.5, h: 0.8, fontSize: 32, bold: true, color: 'FFFFFF', fontFace: FONTS.title, align: 'center' });
    s8.addText(sp.icon, { x, y: y + 1.2, w: 1.5, h: 0.8, fontSize: 32, align: 'center' });
    s8.addText(sp.title, { x: x + 1.7, y: y + 0.2, w: 4.4, h: 0.5, fontSize: 16, bold: true, color: sp.color, fontFace: FONTS.title });
    s8.addText(sp.desc, { x: x + 1.7, y: y + 0.7, w: 4.4, h: 0.5, fontSize: 11, color: COLORS.textPrimary, fontFace: FONTS.body });
    s8.addText(sp.detail, { x: x + 1.7, y: y + 1.3, w: 4.4, h: 1.2, fontSize: 10, color: COLORS.textSecondary, fontFace: FONTS.body, italic: true });
  });
  // 底部金句
  s8.addShape('rect', { x: 0.4, y: 6.95, w: 12.5, h: 0.35, fill: { color: COLORS.primary } });
  s8.addText('🏆 站在巨人肩膀上 · 把自研留给真正缺失的部分 · 把贡献还给社区', { x: 0.5, y: 6.97, w: 12.3, h: 0.32, fontSize: 12, bold: true, color: 'FFFFFF', fontFace: FONTS.title, align: 'center' });
  addPageNumber(s8, 8, TOTAL);

  const out = path.join(__dirname, 'tdsf-ppt-04-opensource.pptx');
  return pptx.writeFile({ fileName: out }).then(() => out);
}

// ============ 主入口 ============
(async () => {
  const results = [];
  for (const [name, fn] of [
    ['PPT-01 产品介绍+技术架构', genPPT01],
    ['PPT-02 Demo 演示流程', genPPT02],
    ['PPT-03 创新点+学术亮点', genPPT03],
    ['PPT-04 开源贡献+复用清单', genPPT04],
  ]) {
    try {
      console.log(`[${name}] 生成中...`);
      const out = await fn();
      console.log(`[${name}] ✅ 完成: ${out}`);
      results.push({ name, out, ok: true });
    } catch (e) {
      console.error(`[${name}] ❌ 失败:`, e.message);
      console.error(e.stack);
      results.push({ name, error: e.message, ok: false });
    }
  }
  console.log('\n========== 汇总 ==========');
  results.forEach((r) => {
    console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.ok ? ' → ' + r.out : ' → ' + r.error}`);
  });
})();