"""TDSF-Linux Desktop 主窗口。

三栏布局（苹果极简留白美学）：
- 左栏：服务器列表 + 新建连接
- 中栏：SSH终端（多标签页）+ 环境监控面板
- 右栏：AI运维助手（Agent可视化 + 对话 + 日志分析）

设计语言：黑白灰为主，大量留白，细线条分割，无装饰。
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QAction, QFont
from PySide6.QtWidgets import (
    QDialog,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSpinBox,
    QSplitter,
    QTabWidget,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

if TYPE_CHECKING:
    from paramiko import Channel

logger = logging.getLogger(__name__)


# ============================================================
# 服务器连接对话框
# ============================================================


class ConnectDialog(QDialog):
    """SSH连接对话框。"""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle("连接服务器")
        self.setMinimumWidth(440)
        self._init_ui()

    def _init_ui(self) -> None:
        """初始化界面。"""
        layout: QFormLayout = QFormLayout(self)
        layout.setSpacing(16)
        layout.setContentsMargins(32, 32, 32, 32)

        # 标题
        title = QLabel("新建连接")
        title_font = QFont()
        title_font.setPointSize(18)
        title_font.setBold(True)
        title.setFont(title_font)
        layout.addRow(title)

        # 基本信息
        self.name_edit: QLineEdit = QLineEdit()
        self.name_edit.setPlaceholderText("可选，如：生产服务器-01")
        layout.addRow("名称", self.name_edit)

        self.host_edit: QLineEdit = QLineEdit()
        self.host_edit.setPlaceholderText("192.168.1.100")
        layout.addRow("主机", self.host_edit)

        self.port_spin: QSpinBox = QSpinBox()
        self.port_spin.setRange(1, 65535)
        self.port_spin.setValue(22)
        layout.addRow("端口", self.port_spin)

        self.username_edit: QLineEdit = QLineEdit()
        self.username_edit.setPlaceholderText("root")
        layout.addRow("用户名", self.username_edit)

        self.password_edit: QLineEdit = QLineEdit()
        self.password_edit.setEchoMode(QLineEdit.EchoMode.Password)
        self.password_edit.setPlaceholderText("密码")
        layout.addRow("密码", self.password_edit)

        # 按钮
        btn_layout: QHBoxLayout = QHBoxLayout()
        btn_layout.addStretch()
        self.cancel_btn: QPushButton = QPushButton("取消")
        self.cancel_btn.clicked.connect(self.reject)
        self.connect_btn: QPushButton = QPushButton("连接")
        self.connect_btn.setObjectName("primaryBtn")
        self.connect_btn.clicked.connect(self.accept)
        btn_layout.addWidget(self.cancel_btn)
        btn_layout.addWidget(self.connect_btn)
        layout.addRow(btn_layout)

    def get_connection_info(self) -> dict[str, str | int]:
        """获取连接信息。"""
        return {
            "name": self.name_edit.text().strip() or self.host_edit.text().strip(),
            "host": self.host_edit.text().strip(),
            "port": self.port_spin.value(),
            "username": self.username_edit.text().strip(),
            "password": self.password_edit.text(),
        }


# ============================================================
# 服务器列表面板（左栏）
# ============================================================


class ServerListPanel(QWidget):
    """服务器列表面板（左栏）。

    展示已保存的服务器列表，支持新建连接。
    采用苹果极简风格：无边框列表，大量留白。
    """

    connect_requested = Signal(dict)  # 连接请求信号

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._init_ui()

    def _init_ui(self) -> None:
        """初始化界面。"""
        layout: QVBoxLayout = QVBoxLayout(self)
        layout.setContentsMargins(16, 24, 16, 16)
        layout.setSpacing(16)

        # 标题
        title = QLabel("服务器")
        title_font = QFont()
        title_font.setPointSize(16)
        title_font.setBold(True)
        title.setFont(title_font)
        layout.addWidget(title)

        # 服务器列表
        self.server_list: QListWidget = QListWidget()
        self.server_list.setMinimumWidth(200)
        layout.addWidget(self.server_list, stretch=1)

        # 新建连接按钮
        self.connect_btn: QPushButton = QPushButton("+ 新建连接")
        self.connect_btn.setObjectName("primaryBtn")
        self.connect_btn.clicked.connect(self._on_new_connection)
        layout.addWidget(self.connect_btn)

        # 提示信息
        hint = QLabel("点击「新建连接」添加服务器")
        hint.setStyleSheet("color: #86868b; font-size: 12px;")
        hint.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(hint)

    def _on_new_connection(self) -> None:
        """新建连接。"""
        dialog: ConnectDialog = ConnectDialog(self)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            info: dict[str, str | int] = dialog.get_connection_info()
            if info["host"]:
                # 添加到列表
                item_text = f"{info['name']}\n{info['host']}:{info['port']}"
                item: QListWidgetItem = QListWidgetItem(item_text)
                item.setData(Qt.ItemDataRole.UserRole, info)
                self.server_list.addItem(item)
                # 发送连接请求
                self.connect_requested.emit(info)


# ============================================================
# 终端面板（中栏，多标签）
# ============================================================


class TerminalPanel(QWidget):
    """终端面板（中栏，多标签页）。

    包含欢迎页和SSH终端标签页。
    """

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._init_ui()

    def _init_ui(self) -> None:
        """初始化界面。"""
        layout: QVBoxLayout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # 标签页
        self.tab_widget: QTabWidget = QTabWidget()
        self.tab_widget.setTabsClosable(True)
        self.tab_widget.tabCloseRequested.connect(self._on_close_tab)
        layout.addWidget(self.tab_widget)

        # 欢迎页
        self._add_welcome_tab()

    def _add_welcome_tab(self) -> None:
        """添加欢迎页。"""
        welcome = QLabel()
        welcome.setAlignment(Qt.AlignmentFlag.AlignCenter)
        welcome.setText(
            "<div style='padding: 60px; text-align: center;'>"
            "<h1 style='font-size: 28px; color: #1d1d1f; font-weight: 600; "
            "margin-bottom: 8px;'>TDSF-Linux Desktop</h1>"
            "<p style='font-size: 15px; color: #86868b; margin-bottom: 40px;'>"
            "面向 Linux 运维的人机协同可信决策桌面助手"
            "</p>"
            "<div style='max-width: 480px; margin: 0 auto; text-align: left;'>"
            "<h3 style='font-size: 14px; color: #1d1d1f; margin-bottom: 12px;'>"
            "快速开始</h3>"
            "<p style='color: #86868b; font-size: 13px; line-height: 2.0;'>"
            "1. 点击左栏「新建连接」添加 SSH 服务器<br>"
            "2. 在右栏「设置」中配置 AI 大模型 API Key<br>"
            "3. 连接服务器后，环境面板自动展示系统信息<br>"
            "4. 在 AI 助手中粘贴日志，获取智能分析建议"
            "</p>"
            "</div>"
            "<div style='max-width: 480px; margin: 32px auto 0; text-align: left;'>"
            "<h3 style='font-size: 14px; color: #1d1d1f; margin-bottom: 12px;'>"
            "核心特色</h3>"
            "<p style='color: #86868b; font-size: 13px; line-height: 2.0;'>"
            "证据可核验 — 每条 AI 建议附带日志证据溯源链<br>"
            "风险可感知 — 5 级风险控制，高危操作需人工确认<br>"
            "本地化安全 — SSH 密钥和 API Key 本地加密存储<br>"
            "LLM 自由接入 — 支持火山方舟 / OpenAI / 任意兼容 API"
            "</p>"
            "</div>"
            "</div>"
        )
        self.tab_widget.addTab(welcome, "欢迎")

    def _on_close_tab(self, index: int) -> None:
        """关闭标签页。"""
        if index == 0:
            return  # 不允许关闭欢迎页
        widget: QWidget | None = self.tab_widget.widget(index)
        if widget is None:
            return
        self.tab_widget.removeTab(index)
        # 调用 TerminalWidget 自定义的 disconnect 方法（关闭 SSH channel）
        disconnect_method = getattr(widget, "disconnect", None)
        if callable(disconnect_method):
            disconnect_method()
        widget.deleteLater()

    def add_terminal_tab(self, name: str, channel: Channel) -> None:
        """添加终端标签页。

        Args:
            name: 标签页名称。
            channel: SSH channel。
        """
        try:
            from tdsf_desktop.ui.terminal_widget import TerminalWidget

            terminal: TerminalWidget = TerminalWidget()
            terminal.set_channel(channel)
            # 关闭欢迎页（如果只有欢迎页）
            if self.tab_widget.count() == 1:
                self.tab_widget.removeTab(0)
            self.tab_widget.addTab(terminal, name)
            self.tab_widget.setCurrentIndex(self.tab_widget.count() - 1)
        except ImportError:
            placeholder = QLabel(
                f"<p style='padding:40px;'>终端组件加载中...<br>已连接到 {name}</p>"
            )
            self.tab_widget.addTab(placeholder, name)


# ============================================================
# AI助手面板（右栏）
# ============================================================


class AIAssistantPanel(QWidget):
    """AI运维助手面板（右栏）。

    包含三个子面板：
    - Agent可视化：展示AI工作流步骤流转
    - 对话区：AI与用户的交互记录
    - 日志分析：粘贴日志，AI分析根因
    """

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._ssh_manager: object | None = None
        self._conn_id: str | None = None
        self._workflow: object | None = None
        self._init_ui()

    def _init_ui(self) -> None:
        """初始化界面。"""
        layout: QVBoxLayout = QVBoxLayout(self)
        layout.setContentsMargins(20, 24, 20, 16)
        layout.setSpacing(16)

        # 标题
        title = QLabel("AI 运维助手")
        title_font = QFont()
        title_font.setPointSize(16)
        title_font.setBold(True)
        title.setFont(title_font)
        layout.addWidget(title)

        # === Agent 可视化区域 ===
        agent_label = QLabel("Agent 工作流")
        agent_label.setStyleSheet("color: #86868b; font-size: 12px; font-weight: 500;")
        layout.addWidget(agent_label)

        self.agent_steps_display: QTextEdit = QTextEdit()
        self.agent_steps_display.setReadOnly(True)
        self.agent_steps_display.setMaximumHeight(180)
        self.agent_steps_display.setPlaceholderText(
            "Agent 工作流将在分析时动态展示：\n"
            "采集环境 → 分析日志 → 生成建议 → 安全检查 → 人工确认 → 执行 → 验证"
        )
        layout.addWidget(self.agent_steps_display)

        # === 对话显示区 ===
        chat_label = QLabel("对话")
        chat_label.setStyleSheet("color: #86868b; font-size: 12px; font-weight: 500;")
        layout.addWidget(chat_label)

        self.chat_display: QTextEdit = QTextEdit()
        self.chat_display.setReadOnly(True)
        self.chat_display.setPlaceholderText(
            "AI 助手就绪。\n\n"
            "使用方法：\n"
            "1. 粘贴日志到下方输入框\n"
            "2. 点击「开始分析」\n"
            "3. Agent 自动采集环境信息并分析\n"
            "4. 确认 AI 建议的命令后执行\n\n"
            "请先在「设置」中配置 API Key"
        )
        layout.addWidget(self.chat_display, stretch=1)

        # === 日志输入区 ===
        input_label = QLabel("粘贴日志")
        input_label.setStyleSheet("color: #86868b; font-size: 12px; font-weight: 500;")
        layout.addWidget(input_label)

        self.log_input: QTextEdit = QTextEdit()
        self.log_input.setPlaceholderText("粘贴服务器日志...\n例如：dmesg、journalctl、应用错误日志")
        self.log_input.setMaximumHeight(120)
        layout.addWidget(self.log_input)

        # === 按钮区 ===
        btn_layout: QHBoxLayout = QHBoxLayout()
        self.analyze_btn: QPushButton = QPushButton("开始分析")
        self.analyze_btn.setObjectName("primaryBtn")
        self.analyze_btn.clicked.connect(self._on_analyze)
        btn_layout.addWidget(self.analyze_btn)

        self.clear_btn: QPushButton = QPushButton("清空")
        self.clear_btn.clicked.connect(self._on_clear)
        btn_layout.addWidget(self.clear_btn)
        layout.addLayout(btn_layout)

    def set_ssh_connection(self, ssh_manager: object, conn_id: str) -> None:
        """设置SSH连接信息。

        Args:
            ssh_manager: SSHConnectionManager 实例
            conn_id: SSH 连接 ID
        """
        self._ssh_manager = ssh_manager
        self._conn_id = conn_id

    def _on_analyze(self) -> None:
        """分析日志：启动 AgentWorkflow。"""
        log_text: str = self.log_input.toPlainText().strip()
        if not log_text:
            QMessageBox.warning(self, "提示", "请先粘贴日志内容")
            return

        if self._ssh_manager is None or self._conn_id is None:
            QMessageBox.warning(self, "提示", "请先连接 SSH 服务器")
            return

        # 清空步骤显示
        self.agent_steps_display.clear()
        self.chat_display.append(
            f"<p style='color: #1d1d1f;'><b>用户：</b> 已粘贴日志 ({len(log_text)} 字符)</p>"
        )
        self.log_input.clear()
        self.analyze_btn.setEnabled(False)
        self.analyze_btn.setText("分析中...")

        # 启动 AgentWorkflow
        import threading

        try:
            from tdsf_desktop.core.ai_agent import AgentWorkflow, LLMClient
            from tdsf_desktop.core.command_safety import CommandSafetyChecker

            llm_client = LLMClient()
            safety_checker = CommandSafetyChecker()
            self._workflow = AgentWorkflow(llm_client, self._ssh_manager, safety_checker)

            # 连接信号
            self._workflow.step_started.connect(self._on_step_started)
            self._workflow.step_completed.connect(self._on_step_completed)
            self._workflow.step_failed.connect(self._on_step_failed)
            self._workflow.workflow_completed.connect(self._on_workflow_completed)
            self._workflow.confirmation_required.connect(self._on_confirmation_required)

            # 在后台线程运行 asyncio 事件循环
            def run_workflow() -> None:
                import asyncio

                if self._workflow is not None:
                    run_method = getattr(self._workflow, "run", None)
                    if callable(run_method):
                        asyncio.run(run_method(log_text, log_text, self._conn_id))

            thread = threading.Thread(target=run_workflow, daemon=True)
            thread.start()

        except Exception as e:
            QMessageBox.critical(self, "错误", f"启动 Agent 失败：{e}")
            self.analyze_btn.setEnabled(True)
            self.analyze_btn.setText("开始分析")

    def _on_step_started(self, step_id: str) -> None:
        """步骤开始。"""
        step_names = {
            "collect_env": "采集环境信息",
            "analyze": "分析日志",
            "suggest": "生成建议",
            "safety_check": "安全检查",
            "confirm": "等待确认",
            "execute": "执行命令",
            "verify": "验证结果",
        }
        name = step_names.get(step_id, step_id)
        self.agent_steps_display.append(
            f"<span style='color: #86868b;'>○</span> <b>{name}</b> — 进行中..."
        )

    def _on_step_completed(self, step_id: str, result: dict[str, Any]) -> None:
        """步骤完成。"""
        step_names = {
            "collect_env": "采集环境信息",
            "analyze": "分析日志",
            "suggest": "生成建议",
            "safety_check": "安全检查",
            "confirm": "等待确认",
            "execute": "执行命令",
            "verify": "验证结果",
        }
        name = step_names.get(step_id, step_id)
        # 提取关键信息
        detail = ""
        if "result" in result:
            r = result["result"]
            if isinstance(r, dict):
                if "hypothesis" in r:
                    detail = r.get("hypothesis", "")[:80]
                elif "command" in r:
                    detail = r.get("command", "")[:80]
                elif "risk_level" in r:
                    detail = f"风险等级: {r.get('risk_level', '')}"
        self.chat_display.append(
            f"<p style='color: #1d1d1f;'><b>✓ {name}</b> {detail}</p>"
        )

    def _on_step_failed(self, step_id: str, error: str) -> None:
        """步骤失败。"""
        step_names = {
            "collect_env": "采集环境信息",
            "analyze": "分析日志",
            "suggest": "生成建议",
            "safety_check": "安全检查",
            "confirm": "等待确认",
            "execute": "执行命令",
            "verify": "验证结果",
        }
        name = step_names.get(step_id, step_id)
        self.agent_steps_display.append(
            f"<span style='color: #c62828;'>✗</span> <b>{name}</b> — 失败: {error[:60]}"
        )

    def _on_workflow_completed(self, final_result: dict[str, Any]) -> None:
        """工作流完成。"""
        self.analyze_btn.setEnabled(True)
        self.analyze_btn.setText("开始分析")

        suggestion = final_result.get("suggestion", {})
        hypothesis = suggestion.get("hypothesis", "未知")
        command = suggestion.get("command", "")
        explanation = suggestion.get("explanation", "")
        confidence = suggestion.get("confidence", 0.0)

        self.chat_display.append(
            f"<p style='color: #1d1d1f; margin-top: 8px;'>"
            f"<b>分析完成</b> (置信度: {confidence:.0%})</p>"
        )
        self.chat_display.append(
            f"<p style='color: #1d1d1f;'><b>根因假设：</b>{hypothesis}</p>"
        )
        if command:
            self.chat_display.append(
                f"<p style='color: #1d1d1f;'><b>建议命令：</b>"
                f"<code style='background: #f5f5f7; padding: 2px 6px; "
                f"border-radius: 4px;'>{command}</code></p>"
            )
        if explanation:
            self.chat_display.append(
                f"<p style='color: #86868b;'><b>说明：</b>{explanation}</p>"
            )

    def _on_confirmation_required(self, suggestion: dict[str, Any]) -> None:
        """需要人工确认。"""
        sug = suggestion.get("suggestion", {})
        safety = suggestion.get("safety", {})
        command = sug.get("command", "")
        risk_level = safety.get("risk_level", "unknown")
        hypothesis = sug.get("hypothesis", "")

        risk_colors = {
            "safe": "#1d1d1f",
            "low": "#1d1d1f",
            "medium": "#86868b",
            "high": "#c62828",
            "critical": "#c62828",
        }
        risk_color = risk_colors.get(risk_level, "#86868b")

        msg = (
            f"<div style='padding: 16px;'>"
            f"<h3 style='font-size: 16px;'>确认执行命令</h3>"
            f"<p style='color: #86868b; margin: 8px 0;'>根因假设：{hypothesis}</p>"
            f"<p style='margin: 8px 0;'><b>命令：</b>"
            f"<code style='background: #f5f5f7; padding: 4px 8px; "
            f"border-radius: 4px;'>{command}</code></p>"
            f"<p style='color: {risk_color}; margin: 8px 0;'>"
            f"<b>风险等级：{risk_level.upper()}</b></p>"
            f"<p style='color: #86868b; font-size: 12px; margin-top: 12px;'>"
            f"确认后将通过 SSH 执行此命令</p>"
            f"</div>"
        )

        reply = QMessageBox.question(
            self,
            "确认执行",
            msg,
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        )

        if reply == QMessageBox.StandardButton.Yes and self._workflow:
            approve_method = getattr(self._workflow, "approve_execution", None)
            if callable(approve_method):
                approve_method()
            self.chat_display.append(
                "<p style='color: #1d1d1f;'><b>用户确认：</b> 执行命令</p>"
            )
        elif self._workflow:
            reject_method = getattr(self._workflow, "reject_execution", None)
            if callable(reject_method):
                reject_method()
            self.chat_display.append(
                "<p style='color: #86868b;'><b>用户拒绝：</b> 取消执行</p>"
            )

    def _on_clear(self) -> None:
        """清空输入。"""
        self.log_input.clear()


# ============================================================
# 主窗口
# ============================================================


class MainWindow(QMainWindow):
    """TDSF-Linux Desktop 主窗口。

    三栏布局：
    - 左栏（2/10）：服务器列表
    - 中栏（5/10）：终端 + 环境监控
    - 右栏（3/10）：AI 助手 + 设置
    """

    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("TDSF-Linux Desktop")
        self.setMinimumSize(1280, 820)
        # SSH 连接管理（复用，避免多实例导致连接状态不一致）
        self._ssh_manager: object | None = None
        self._conn_id: str | None = None
        self._init_ui()
        self._init_menu()
        self._init_status_bar()

    def _init_ui(self) -> None:
        """初始化三栏布局。"""
        central: QWidget = QWidget()
        self.setCentralWidget(central)
        layout: QHBoxLayout = QHBoxLayout(central)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # 分割器
        splitter: QSplitter = QSplitter(Qt.Orientation.Horizontal)
        layout.addWidget(splitter)

        # 左栏：服务器列表
        self.server_panel: ServerListPanel = ServerListPanel()
        self.server_panel.connect_requested.connect(self._on_connect)
        splitter.addWidget(self.server_panel)

        # 中栏：终端 + 环境监控（Tab切换）
        self.center_tabs: QTabWidget = QTabWidget()
        self.terminal_panel: TerminalPanel = TerminalPanel()
        self.center_tabs.addTab(self.terminal_panel, "终端")

        # 环境监控面板（延迟加载）
        self.env_panel: QWidget | None = None
        self.center_tabs.addTab(self._create_env_placeholder(), "环境监控")
        splitter.addWidget(self.center_tabs)

        # 右栏：AI助手/设置 Tab
        self.right_tabs: QTabWidget = QTabWidget()
        self.ai_panel: AIAssistantPanel = AIAssistantPanel()
        self.right_tabs.addTab(self.ai_panel, "AI 助手")

        # 设置页面
        try:
            from tdsf_desktop.ui.settings_widget import SettingsWidget

            self.settings_widget: SettingsWidget = SettingsWidget()
            self.right_tabs.addTab(self.settings_widget, "设置")
        except ImportError:
            placeholder = QLabel("设置页面加载失败")
            placeholder.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.right_tabs.addTab(placeholder, "设置")

        splitter.addWidget(self.right_tabs)

        # 设置比例 2:5:3
        splitter.setSizes([260, 640, 380])
        splitter.setCollapsible(0, False)
        splitter.setCollapsible(1, False)
        splitter.setCollapsible(2, False)

    def _create_env_placeholder(self) -> QWidget:
        """创建环境监控占位页。"""
        placeholder = QLabel(
            "<div style='padding: 60px; text-align: center;'>"
            "<p style='color: #86868b; font-size: 15px;'>"
            "连接服务器后，环境监控面板将自动展示：<br><br>"
            "系统信息（主机名 / OS / 内核 / CPU / 内存）<br>"
            "实时指标（CPU使用率 / 内存 / 磁盘 / 网络）<br>"
            "进程列表（Top 10）<br><br>"
            "数据每 3 秒自动刷新"
            "</p>"
            "</div>"
        )
        placeholder.setAlignment(Qt.AlignmentFlag.AlignCenter)
        return placeholder

    def _init_menu(self) -> None:
        """初始化菜单栏。"""
        menubar = self.menuBar()

        # 文件菜单
        file_menu = menubar.addMenu("文件")
        new_conn_action: QAction = QAction("新建连接", self)
        new_conn_action.setShortcut("Ctrl+N")
        new_conn_action.triggered.connect(self.server_panel._on_new_connection)
        file_menu.addAction(new_conn_action)
        file_menu.addSeparator()
        exit_action: QAction = QAction("退出", self)
        exit_action.setShortcut("Ctrl+Q")
        exit_action.triggered.connect(self.close)
        file_menu.addAction(exit_action)

        # 视图菜单
        view_menu = menubar.addMenu("视图")
        theme_action: QAction = QAction("切换主题", self)
        view_menu.addAction(theme_action)

        # 帮助菜单
        help_menu = menubar.addMenu("帮助")
        about_action: QAction = QAction("关于", self)
        about_action.triggered.connect(self._show_about)
        help_menu.addAction(about_action)

    def _init_status_bar(self) -> None:
        """初始化状态栏。"""
        self.statusBar().showMessage("就绪")

    def _on_connect(self, info: dict[str, str | int]) -> None:
        """处理连接请求。

        创建 SSHConnectionManager 并建立连接，保存到 self._ssh_manager，
        然后传递给 AI 助手面板和环境监控面板，确保三处使用同一连接实例。
        """
        self.statusBar().showMessage(f"正在连接 {info['host']}:{info['port']}...")

        try:
            from tdsf_desktop.ssh.connection import SSHConnectionManager

            manager: SSHConnectionManager = SSHConnectionManager()
            conn_id: str = manager.connect(
                host=str(info["host"]),
                port=int(info["port"]),
                username=str(info["username"]),
                auth_method="password",
                password=str(info["password"]),
            )

            # 保存连接信息供后续复用
            self._ssh_manager = manager
            self._conn_id = conn_id

            # 打开交互式shell
            channel = manager.open_shell(conn_id)
            channel.invoke_shell()

            # 添加终端标签页
            self.terminal_panel.add_terminal_tab(str(info["name"]), channel)

            # 传递 SSH 连接信息给 AI 助手面板（Agent 工作流需要）
            self.ai_panel.set_ssh_connection(manager, conn_id)

            # 加载环境监控面板（复用同一 manager）
            self._load_env_panel(conn_id)

            self.statusBar().showMessage(f"已连接 {info['name']} ({info['host']})")
        except Exception as e:
            QMessageBox.critical(self, "连接失败", f"无法连接到 {info['host']}:\n{e}")
            self.statusBar().showMessage("连接失败")

    def _load_env_panel(self, conn_id: str) -> None:
        """加载环境监控面板。

        复用 self._ssh_manager（由 _on_connect 保存），避免创建新实例。

        Args:
            conn_id: SSH连接ID
        """
        try:
            from tdsf_desktop.ui.server_info_widget import ServerInfoWidget

            # 替换占位页
            old_widget = self.center_tabs.widget(1)
            if old_widget is None:
                return
            idx = self.center_tabs.indexOf(old_widget)
            self.env_panel = ServerInfoWidget()
            # 复用已保存的 SSH 连接管理器
            if self._ssh_manager is not None:
                self.env_panel.start_monitoring(
                    self._ssh_manager,  # type: ignore[arg-type]
                    conn_id,
                )
            self.center_tabs.removeTab(idx)
            self.center_tabs.insertTab(idx, self.env_panel, "环境监控")
            self.center_tabs.setCurrentIndex(idx)
            old_widget.deleteLater()
        except ImportError:
            logger.warning("环境监控面板未就绪")

    def _show_about(self) -> None:
        """显示关于对话框。"""
        QMessageBox.about(
            self,
            "关于 TDSF-Linux Desktop",
            "<div style='padding: 20px;'>"
            "<h2 style='font-size: 20px; font-weight: 600;'>TDSF-Linux Desktop</h2>"
            "<p style='color: #86868b; margin: 4px 0 16px;'>v0.1.0</p>"
            "<p>面向 Linux 运维的人机协同可信决策桌面助手</p>"
            "<p style='margin-top: 16px;'><b>核心特色</b></p>"
            "<ul style='color: #86868b; line-height: 2.0;'>"
            "<li>证据可核验 — Ground-Check 证据溯源</li>"
            "<li>风险可感知 — 5 级风险控制</li>"
            "<li>本地化安全 — 密钥本地加密存储</li>"
            "<li>LLM 自由接入 — 支持任意 OpenAI 兼容 API</li>"
            "</ul>"
            "<p style='color: #86868b; margin-top: 16px; font-size: 12px;'>"
            "2026 火山杯 Agent 创新大赛参赛项目"
            "</p>"
            "</div>",
        )
