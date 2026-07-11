"""服务器环境监控面板组件。

展示SSH连接的远程Linux服务器系统信息和实时指标，采用苹果极简留白美学（黑白灰为主）。
布局分为三个区域：
1. 系统信息区（静态，一次性采集）：主机名、操作系统、内核版本等
2. 实时指标区（每3秒刷新）：CPU使用率、内存、磁盘、网络
3. 进程列表区（Top 10，按CPU排序）

通过SystemMonitor后台线程采集数据，信号驱动更新UI，不阻塞主线程。
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from PySide6.QtCore import Qt
from PySide6.QtGui import QFont
from PySide6.QtWidgets import (
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QProgressBar,
    QScrollArea,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

if TYPE_CHECKING:
    from tdsf_desktop.ssh.connection import SSHConnectionManager
    from tdsf_desktop.ssh.monitor import SystemMonitor

logger = logging.getLogger(__name__)

# ============================================================================
# 主题常量（苹果极简留白美学：黑白灰为主，大量留白，细线条分割）
# ============================================================================
_COLOR_BG = "#ffffff"
_COLOR_TEXT_PRIMARY = "#1d1d1f"
_COLOR_TEXT_SECONDARY = "#86868b"
_COLOR_DIVIDER = "#e5e5e7"
_COLOR_CARD_BG = "#f5f5f7"
_COLOR_DANGER = "#c62828"


class ServerInfoWidget(QWidget):
    """服务器环境监控面板。

    类似FinalShell的服务器环境监控，展示SSH连接的远程Linux服务器
    系统信息和实时指标。采用苹果极简留白美学设计（黑白灰为主，大量留白）。

    通过SystemMonitor后台线程采集数据，通过信号更新UI：
    - system_info_collected: 一次性系统静态信息
    - metrics_updated: 定时实时指标（CPU/内存/磁盘/网络）
    - monitoring_error: 采集错误

    Usage:
        >>> widget = ServerInfoWidget()
        >>> widget.start_monitoring(ssh_manager, conn_id)
        >>> # ... 使用完毕后
        >>> widget.stop_monitoring()
    """

    def __init__(self, parent: QWidget | None = None) -> None:
        """初始化服务器环境监控面板。

        Args:
            parent: 父组件
        """
        super().__init__(parent)
        self._monitor: SystemMonitor | None = None
        self._init_ui()

    # ============================================================
    # UI 构建
    # ============================================================

    def _init_ui(self) -> None:
        """构建面板UI。"""
        self.setObjectName("ServerInfoWidget")
        self.setStyleSheet(self._build_stylesheet())

        # 外层滚动区域（内容可能超出视口）
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)

        content = QWidget()
        content.setObjectName("content")

        layout = QVBoxLayout(content)
        layout.setContentsMargins(32, 32, 32, 32)
        layout.setSpacing(28)

        # 三个区块
        layout.addWidget(self._build_system_info_section())
        layout.addWidget(self._create_divider())
        layout.addWidget(self._build_metrics_section())
        layout.addWidget(self._create_divider())
        layout.addWidget(self._build_process_section())
        layout.addStretch(1)

        scroll.setWidget(content)

        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.addWidget(scroll)

    def _build_system_info_section(self) -> QWidget:
        """构建系统信息区（2列4行信息卡片）。"""
        section = QWidget()
        layout = QVBoxLayout(section)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(16)

        layout.addWidget(self._create_section_header("系统信息"))

        # 2列4行信息卡片网格
        grid = QGridLayout()
        grid.setSpacing(12)

        info_items = [
            ("主机名", "hostname"),
            ("操作系统", "os"),
            ("内核版本", "kernel"),
            ("架构", "arch"),
            ("运行时长", "uptime"),
            ("CPU 型号", "cpu_model"),
            ("核心数", "cpu_cores"),
            ("负载", "load_average"),
        ]

        self._info_labels: dict[str, QLabel] = {}
        for i, (label_text, key) in enumerate(info_items):
            row, col = divmod(i, 2)
            card, value_label = self._create_info_card(label_text)
            self._info_labels[key] = value_label
            grid.addWidget(card, row, col)

        grid.setColumnStretch(0, 1)
        grid.setColumnStretch(1, 1)
        layout.addLayout(grid)

        return section

    def _build_metrics_section(self) -> QWidget:
        """构建实时指标区（4个指标卡片横向排列）。"""
        section = QWidget()
        layout = QVBoxLayout(section)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(16)

        layout.addWidget(self._create_section_header("实时指标"))

        cards = QHBoxLayout()
        cards.setSpacing(12)

        # --- CPU 卡片 ---
        (
            cpu_card,
            self._cpu_value_label,
            self._cpu_progress,
            self._cpu_detail_label,
        ) = self._create_metric_card("CPU 使用率")
        cards.addWidget(cpu_card)

        # --- 内存卡片 ---
        (
            mem_card,
            self._mem_value_label,
            self._mem_progress,
            self._mem_detail_label,
        ) = self._create_metric_card("内存使用率")
        cards.addWidget(mem_card)

        # --- 磁盘卡片 ---
        disk_card = QFrame()
        disk_card.setObjectName("metricCard")
        disk_card.setMinimumWidth(200)
        disk_layout = QVBoxLayout(disk_card)
        disk_layout.setContentsMargins(16, 16, 16, 16)
        disk_layout.setSpacing(8)

        disk_layout.addWidget(self._create_card_label("磁盘"))

        self._disk_list_layout = QVBoxLayout()
        self._disk_list_layout.setSpacing(4)
        self._disk_list_layout.setContentsMargins(0, 0, 0, 0)
        disk_layout.addLayout(self._disk_list_layout)
        disk_layout.addStretch(1)
        cards.addWidget(disk_card)

        # --- 网络卡片 ---
        net_card = QFrame()
        net_card.setObjectName("metricCard")
        net_card.setMinimumWidth(200)
        net_layout = QVBoxLayout(net_card)
        net_layout.setContentsMargins(16, 16, 16, 16)
        net_layout.setSpacing(8)

        net_layout.addWidget(self._create_card_label("网络"))

        self._net_list_layout = QVBoxLayout()
        self._net_list_layout.setSpacing(4)
        self._net_list_layout.setContentsMargins(0, 0, 0, 0)
        net_layout.addLayout(self._net_list_layout)
        net_layout.addStretch(1)
        cards.addWidget(net_card)

        layout.addLayout(cards)
        return section

    def _build_process_section(self) -> QWidget:
        """构建进程列表区（Top 10表格）。"""
        section = QWidget()
        layout = QVBoxLayout(section)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(16)

        layout.addWidget(self._create_section_header("进程列表 (Top 10)"))

        self._process_table = QTableWidget(0, 4)
        self._process_table.setHorizontalHeaderLabels(["PID", "CPU%", "MEM%", "COMMAND"])
        self._process_table.setShowGrid(False)
        self._process_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self._process_table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self._process_table.verticalHeader().setVisible(False)
        self._process_table.setMinimumHeight(200)

        header = self._process_table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(3, QHeaderView.ResizeMode.Stretch)
        header.setStretchLastSection(False)

        layout.addWidget(self._process_table)
        return section

    # ============================================================
    # UI 辅助方法
    # ============================================================

    def _create_section_header(self, title: str) -> QLabel:
        """创建区块标题。

        Args:
            title: 标题文本

        Returns:
            标题QLabel
        """
        label = QLabel(title)
        font = QFont()
        font.setPointSize(15)
        font.setBold(True)
        label.setFont(font)
        label.setStyleSheet(f"color: {_COLOR_TEXT_PRIMARY};")
        return label

    def _create_card_label(self, text: str) -> QLabel:
        """创建卡片内小标题。

        Args:
            text: 标题文本

        Returns:
            卡片标题QLabel
        """
        label = QLabel(text)
        label.setStyleSheet(f"color: {_COLOR_TEXT_SECONDARY}; font-size: 11pt;")
        return label

    def _create_divider(self) -> QFrame:
        """创建分割线。

        Returns:
            分割线QFrame
        """
        line = QFrame()
        line.setFixedHeight(1)
        line.setStyleSheet(f"background-color: {_COLOR_DIVIDER}; border: none;")
        return line

    def _create_info_card(self, label_text: str) -> tuple[QFrame, QLabel]:
        """创建信息卡片（标签 + 值）。

        样式：背景#f5f5f7，圆角8px，内边距16px。

        Args:
            label_text: 标签文本

        Returns:
            (卡片QFrame, 值QLabel) 元组
        """
        card = QFrame()
        card.setObjectName("infoCard")
        layout = QVBoxLayout(card)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(6)

        label = QLabel(label_text)
        label.setStyleSheet(f"color: {_COLOR_TEXT_SECONDARY}; font-size: 11pt;")
        layout.addWidget(label)

        value_label = QLabel("—")
        value_font = QFont()
        value_font.setPointSize(13)
        value_label.setFont(value_font)
        value_label.setStyleSheet(f"color: {_COLOR_TEXT_PRIMARY};")
        value_label.setWordWrap(True)
        layout.addWidget(value_label)

        layout.addStretch(1)
        return card, value_label

    def _create_metric_card(
        self, title: str
    ) -> tuple[QFrame, QLabel, QProgressBar, QLabel]:
        """创建指标卡片（大数字 + 进度条 + 详情文本）。

        Args:
            title: 卡片标题

        Returns:
            (卡片QFrame, 数值QLabel, 进度条QProgressBar, 详情QLabel) 元组
        """
        card = QFrame()
        card.setObjectName("metricCard")
        card.setMinimumWidth(180)
        layout = QVBoxLayout(card)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(8)

        layout.addWidget(self._create_card_label(title))

        # 大数字
        value_label = QLabel("—")
        big_font = QFont()
        big_font.setPointSize(22)
        big_font.setBold(True)
        value_label.setFont(big_font)
        value_label.setStyleSheet(f"color: {_COLOR_TEXT_PRIMARY};")
        layout.addWidget(value_label)

        # 进度条
        progress = QProgressBar()
        progress.setRange(0, 100)
        progress.setValue(0)
        progress.setTextVisible(False)
        progress.setFixedHeight(6)
        layout.addWidget(progress)

        # 详情文本
        detail_label = QLabel("")
        detail_label.setStyleSheet(f"color: {_COLOR_TEXT_SECONDARY}; font-size: 10pt;")
        layout.addWidget(detail_label)

        layout.addStretch(1)
        return card, value_label, progress, detail_label

    # ============================================================
    # 监控控制
    # ============================================================

    def start_monitoring(self, ssh_manager: SSHConnectionManager, conn_id: str) -> None:
        """启动监控。

        创建SystemMonitor后台线程，连接信号，开始采集数据。

        Args:
            ssh_manager: SSH连接管理器
            conn_id: SSH连接ID
        """
        from tdsf_desktop.ssh.monitor import SystemMonitor

        self._monitor = SystemMonitor(ssh_manager, conn_id, interval=3.0)
        self._monitor.system_info_collected.connect(self._on_system_info)
        self._monitor.metrics_updated.connect(self._on_metrics_updated)
        self._monitor.monitoring_error.connect(self._on_error)
        self._monitor.start()

    def stop_monitoring(self) -> None:
        """停止监控。"""
        if self._monitor is not None:
            self._monitor.stop()

    # ============================================================
    # 信号处理
    # ============================================================

    def _on_system_info(self, info: dict) -> None:
        """更新系统信息显示。

        Args:
            info: 系统信息字典，包含 hostname/os/kernel/arch/uptime/
                  cpu_model/cpu_cores/load_average
        """
        self._info_labels["hostname"].setText(info.get("hostname") or "—")
        self._info_labels["os"].setText(info.get("os") or "—")
        self._info_labels["kernel"].setText(info.get("kernel") or "—")
        self._info_labels["arch"].setText(info.get("arch") or "—")
        self._info_labels["uptime"].setText(info.get("uptime") or "—")
        self._info_labels["cpu_model"].setText(info.get("cpu_model") or "—")

        cores = info.get("cpu_cores", 0)
        self._info_labels["cpu_cores"].setText(f"{cores} 核" if cores else "—")

        load_avg = info.get("load_average", [])
        if load_avg and len(load_avg) >= 3:
            load_text = f"{load_avg[0]:.2f}  {load_avg[1]:.2f}  {load_avg[2]:.2f}"
        else:
            load_text = "—"
        self._info_labels["load_average"].setText(load_text)

    def _on_metrics_updated(self, metrics: dict) -> None:
        """更新实时指标显示。

        Args:
            metrics: 实时指标字典，包含 cpu_usage/mem_usage_percent/
                     disk_partitions/network_interfaces 等
        """
        # CPU
        cpu_usage = metrics.get("cpu_usage", 0.0)
        self._cpu_value_label.setText(f"{cpu_usage:.0f}%")
        self._cpu_progress.setValue(int(cpu_usage))
        cpu_user = metrics.get("cpu_user_usage", 0.0)
        cpu_sys = metrics.get("cpu_system_usage", 0.0)
        cpu_io = metrics.get("cpu_iowait", 0.0)
        self._cpu_detail_label.setText(
            f"用户 {cpu_user:.1f}%  ·  系统 {cpu_sys:.1f}%  ·  IO {cpu_io:.1f}%"
        )

        # 内存
        mem_percent = metrics.get("mem_usage_percent", 0.0)
        mem_used = metrics.get("mem_used", 0)
        mem_total = metrics.get("mem_total", 0)
        self._mem_value_label.setText(f"{mem_percent:.0f}%")
        self._mem_progress.setValue(int(mem_percent))
        self._mem_detail_label.setText(
            f"{self._format_memory(mem_used)} / {self._format_memory(mem_total)}"
        )

        # 磁盘
        self._update_disk_list(metrics.get("disk_partitions", []))

        # 网络
        self._update_network_list(metrics.get("network_interfaces", []))

        # 进程（当前SystemMonitor未采集进程数据，预留接口）
        if "processes" in metrics:
            self._update_process_table(metrics["processes"])

    def _on_error(self, error: str) -> None:
        """处理采集错误。

        Args:
            error: 错误信息
        """
        logger.error("监控错误: %s", error)

    # ============================================================
    # 列表更新
    # ============================================================

    def _update_disk_list(self, partitions: list[dict]) -> None:
        """更新磁盘分区列表。

        Args:
            partitions: 分区信息字典列表，每个字典包含 filesystem/size/used/
                        available/usage_percent/mount_point
        """
        self._clear_layout(self._disk_list_layout)

        if not partitions:
            placeholder = QLabel("暂无磁盘数据")
            placeholder.setStyleSheet(f"color: {_COLOR_TEXT_SECONDARY}; font-size: 10pt;")
            self._disk_list_layout.addWidget(placeholder)
            return

        for part in partitions:
            row_widget = QWidget()
            row_layout = QHBoxLayout(row_widget)
            row_layout.setContentsMargins(0, 0, 0, 0)
            row_layout.setSpacing(8)

            fs_label = QLabel(str(part.get("filesystem", "")))
            fs_label.setStyleSheet(f"color: {_COLOR_TEXT_PRIMARY}; font-size: 10pt;")
            row_layout.addWidget(fs_label)

            size_label = QLabel(str(part.get("size", "")))
            size_label.setStyleSheet(f"color: {_COLOR_TEXT_SECONDARY}; font-size: 10pt;")
            row_layout.addWidget(size_label)

            usage = part.get("usage_percent", 0.0)
            color = _COLOR_DANGER if usage >= 90 else _COLOR_TEXT_PRIMARY
            usage_label = QLabel(f"{usage:.0f}%")
            usage_label.setStyleSheet(f"color: {color}; font-size: 10pt; font-weight: bold;")
            row_layout.addWidget(usage_label)

            mount_label = QLabel(str(part.get("mount_point", "")))
            mount_label.setStyleSheet(f"color: {_COLOR_TEXT_SECONDARY}; font-size: 10pt;")
            row_layout.addWidget(mount_label)

            row_layout.addStretch(1)
            self._disk_list_layout.addWidget(row_widget)

    def _update_network_list(self, interfaces: list[dict]) -> None:
        """更新网络接口列表。

        Args:
            interfaces: 接口信息字典列表，每个字典包含 name/rx_speed/tx_speed/
                        rx_bytes/tx_bytes
        """
        self._clear_layout(self._net_list_layout)

        if not interfaces:
            placeholder = QLabel("暂无网络数据")
            placeholder.setStyleSheet(f"color: {_COLOR_TEXT_SECONDARY}; font-size: 10pt;")
            self._net_list_layout.addWidget(placeholder)
            return

        for iface in interfaces:
            row_widget = QWidget()
            row_layout = QHBoxLayout(row_widget)
            row_layout.setContentsMargins(0, 0, 0, 0)
            row_layout.setSpacing(8)

            name_label = QLabel(str(iface.get("name", "")))
            name_label.setStyleSheet(f"color: {_COLOR_TEXT_PRIMARY}; font-size: 10pt;")
            row_layout.addWidget(name_label)

            rx_speed = iface.get("rx_speed", 0.0)
            rx_label = QLabel(f"↓ {self._format_speed(rx_speed)}")
            rx_label.setStyleSheet(f"color: {_COLOR_TEXT_SECONDARY}; font-size: 10pt;")
            row_layout.addWidget(rx_label)

            tx_speed = iface.get("tx_speed", 0.0)
            tx_label = QLabel(f"↑ {self._format_speed(tx_speed)}")
            tx_label.setStyleSheet(f"color: {_COLOR_TEXT_SECONDARY}; font-size: 10pt;")
            row_layout.addWidget(tx_label)

            row_layout.addStretch(1)
            self._net_list_layout.addWidget(row_widget)

    def _update_process_table(self, processes: list[dict]) -> None:
        """更新进程列表表格。

        Args:
            processes: 进程信息字典列表，每个字典包含 pid/cpu/mem/command
        """
        self._process_table.setRowCount(0)

        for proc in processes[:10]:
            row = self._process_table.rowCount()
            self._process_table.insertRow(row)

            pid_item = QTableWidgetItem(str(proc.get("pid", "")))
            pid_item.setTextAlignment(
                Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter
            )
            self._process_table.setItem(row, 0, pid_item)

            cpu_item = QTableWidgetItem(f"{proc.get('cpu', 0):.1f}")
            cpu_item.setTextAlignment(
                Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter
            )
            self._process_table.setItem(row, 1, cpu_item)

            mem_item = QTableWidgetItem(f"{proc.get('mem', 0):.1f}")
            mem_item.setTextAlignment(
                Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter
            )
            self._process_table.setItem(row, 2, mem_item)

            cmd_item = QTableWidgetItem(str(proc.get("command", "")))
            self._process_table.setItem(row, 3, cmd_item)

    # ============================================================
    # 辅助方法
    # ============================================================

    @staticmethod
    def _clear_layout(layout: QVBoxLayout) -> None:
        """清空布局中的所有子项。

        Args:
            layout: 要清空的布局
        """
        while layout.count():
            item = layout.takeAt(0)
            if item is None:
                continue
            widget = item.widget()
            if widget is not None:
                widget.setParent(None)
                widget.deleteLater()

    @staticmethod
    def _format_speed(bytes_per_sec: float) -> str:
        """格式化网络速率为可读字符串。

        Args:
            bytes_per_sec: 字节/秒

        Returns:
            可读速率字符串，如 "1.2 KB/s"
        """
        if bytes_per_sec < 0:
            return "0 B/s"
        if bytes_per_sec < 1024:
            return f"{bytes_per_sec:.0f} B/s"
        if bytes_per_sec < 1024 * 1024:
            return f"{bytes_per_sec / 1024:.1f} KB/s"
        return f"{bytes_per_sec / (1024 * 1024):.1f} MB/s"

    @staticmethod
    def _format_memory(mb: float) -> str:
        """格式化内存大小（MB转GB显示）。

        Args:
            mb: 内存大小（MB）

        Returns:
            可读内存字符串，如 "7.8 GB"
        """
        if mb >= 1024:
            return f"{mb / 1024:.1f} GB"
        return f"{mb:.0f} MB"

    @staticmethod
    def _build_stylesheet() -> str:
        """构建全局QSS样式表。

        苹果极简风格：纯白背景、灰白卡片、黑色进度条填充、无网格线表格。

        Returns:
            QSS样式字符串
        """
        return f"""
        #ServerInfoWidget, #content {{
            background-color: {_COLOR_BG};
        }}
        QScrollArea {{
            background-color: {_COLOR_BG};
            border: none;
        }}
        QScrollArea > QWidget > QWidget {{
            background-color: {_COLOR_BG};
        }}
        QFrame#infoCard {{
            background-color: {_COLOR_CARD_BG};
            border: none;
            border-radius: 8px;
        }}
        QFrame#metricCard {{
            background-color: {_COLOR_CARD_BG};
            border: none;
            border-radius: 8px;
        }}
        QProgressBar {{
            background-color: {_COLOR_DIVIDER};
            border: none;
            border-radius: 3px;
        }}
        QProgressBar::chunk {{
            background-color: {_COLOR_TEXT_PRIMARY};
            border-radius: 3px;
        }}
        QTableWidget {{
            background-color: {_COLOR_BG};
            border: none;
            gridline-color: transparent;
        }}
        QTableWidget::item {{
            border: none;
            padding: 6px 8px;
            color: {_COLOR_TEXT_PRIMARY};
        }}
        QTableWidget::item:selected {{
            background-color: {_COLOR_CARD_BG};
        }}
        QHeaderView::section {{
            background-color: {_COLOR_BG};
            color: {_COLOR_TEXT_SECONDARY};
            border: none;
            border-bottom: 1px solid {_COLOR_DIVIDER};
            padding: 8px 8px;
            font-size: 11pt;
        }}
        QTableCornerButton::section {{
            background-color: {_COLOR_BG};
            border: none;
        }}
        """
