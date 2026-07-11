"""TDSF-Linux Desktop 应用入口。

启动 PySide6 应用程序，创建主窗口并进入事件循环。
支持高 DPI 缩放，配置日志系统。

Usage:
    python -m tdsf_desktop.app
    # 或开发模式（从源码运行）
    python src/tdsf_desktop/app.py
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

# 确保 src 目录在 sys.path 中（支持从源码直接运行）
# 必须在导入 tdsf_desktop 之前完成
_SRC_DIR = str(Path(__file__).resolve().parent.parent)
if _SRC_DIR not in sys.path:
    sys.path.insert(0, _SRC_DIR)

# E402: 上面的 sys.path 操作导致 import 不在文件顶部，这里是必要的
from PySide6.QtGui import QFont  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

from tdsf_desktop.main_window import MainWindow  # noqa: E402

# ============================================================
# 日志配置
# ============================================================

_LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
_LOG_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def _setup_logging() -> None:
    """配置全局日志系统。

    开发模式下输出 DEBUG 级别到控制台，生产模式下输出 INFO 级别。
    """
    level = logging.DEBUG if "--debug" in sys.argv else logging.INFO
    logging.basicConfig(
        level=level,
        format=_LOG_FORMAT,
        datefmt=_LOG_DATE_FORMAT,
        stream=sys.stdout,
    )
    # 降低第三方库的日志噪声
    logging.getLogger("paramiko").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("openai").setLevel(logging.WARNING)


# ============================================================
# 应用启动
# ============================================================


def _apply_app_style(app: QApplication) -> None:
    """应用全局样式。

    采用苹果官网极简留白美学：
    - 纯白背景 + 大量留白
    - 黑白灰为主色调（#1d1d1f 文字 / #86868b 次要 / #f5f5f7 背景 / #e5e5e7 分割线）
    - 细线条分割，无装饰
    - 小圆角（6px），选中态用浅灰

    Args:
        app: QApplication 实例
    """
    # 全局默认字体（近似 SF Pro 的中文替代）
    default_font = QFont("Microsoft YaHei UI", 10)
    app.setFont(default_font)

    # 全局样式表（苹果极简设计系统）
    app.setStyleSheet(
        """
        /* ===== 全局基础 ===== */
        QMainWindow, QWidget {
            background-color: #ffffff;
            color: #1d1d1f;
        }

        /* ===== 菜单栏 ===== */
        QMenuBar {
            background-color: #ffffff;
            border-bottom: 1px solid #e5e5e7;
            padding: 2px 8px;
        }
        QMenuBar::item {
            padding: 6px 14px;
            border-radius: 6px;
            color: #1d1d1f;
            background: transparent;
        }
        QMenuBar::item:selected {
            background-color: #f5f5f7;
        }

        /* ===== 下拉菜单 ===== */
        QMenu {
            background-color: #ffffff;
            border: 1px solid #e5e5e7;
            border-radius: 8px;
            padding: 6px;
        }
        QMenu::item {
            padding: 8px 28px;
            border-radius: 6px;
            color: #1d1d1f;
        }
        QMenu::item:selected {
            background-color: #f5f5f7;
        }
        QMenu::separator {
            height: 1px;
            background: #e5e5e7;
            margin: 4px 12px;
        }

        /* ===== 状态栏 ===== */
        QStatusBar {
            background-color: #ffffff;
            border-top: 1px solid #e5e5e7;
            color: #86868b;
            padding: 2px 12px;
        }

        /* ===== 标签页 ===== */
        QTabWidget::pane {
            border: none;
            background-color: #ffffff;
        }
        QTabBar::tab {
            background-color: transparent;
            border: none;
            padding: 8px 18px;
            margin-right: 4px;
            color: #86868b;
            font-size: 13px;
        }
        QTabBar::tab:selected {
            color: #1d1d1f;
            border-bottom: 2px solid #1d1d1f;
        }
        QTabBar::tab:hover:!selected {
            color: #1d1d1f;
        }

        /* ===== 分割器 ===== */
        QSplitter::handle {
            background-color: #e5e5e7;
        }
        QSplitter::handle:horizontal {
            width: 1px;
        }
        QSplitter::handle:vertical {
            height: 1px;
        }

        /* ===== 滚动区域 ===== */
        QScrollArea {
            border: none;
            background: transparent;
        }

        /* ===== 输入框 ===== */
        QLineEdit, QTextEdit, QPlainTextEdit, QSpinBox {
            background-color: #f5f5f7;
            border: 1px solid #e5e5e7;
            border-radius: 8px;
            padding: 8px 12px;
            color: #1d1d1f;
            selection-background-color: #d0d0d4;
        }
        QLineEdit:focus, QTextEdit:focus, QPlainTextEdit:focus, QSpinBox:focus {
            border: 1px solid #1d1d1f;
            background-color: #ffffff;
        }

        /* ===== 按钮 ===== */
        QPushButton {
            background-color: #f5f5f7;
            border: 1px solid #e5e5e7;
            border-radius: 8px;
            padding: 8px 20px;
            color: #1d1d1f;
            font-size: 13px;
        }
        QPushButton:hover {
            background-color: #e8e8ed;
        }
        QPushButton:pressed {
            background-color: #d0d0d4;
        }
        QPushButton#primaryBtn {
            background-color: #1d1d1f;
            color: #ffffff;
            border: 1px solid #1d1d1f;
            font-weight: 500;
        }
        QPushButton#primaryBtn:hover {
            background-color: #424245;
            border-color: #424245;
        }
        QPushButton#primaryBtn:pressed {
            background-color: #000000;
        }
        QPushButton:disabled {
            color: #86868b;
            background-color: #f5f5f7;
        }

        /* ===== 列表 ===== */
        QListWidget {
            background-color: #ffffff;
            border: none;
            outline: none;
        }
        QListWidget::item {
            padding: 10px 16px;
            border-bottom: 1px solid #f5f5f7;
        }
        QListWidget::item:selected {
            background-color: #f5f5f7;
            color: #1d1d1f;
        }
        QListWidget::item:hover {
            background-color: #fafafa;
        }

        /* ===== 标签 ===== */
        QLabel {
            color: #1d1d1f;
            background: transparent;
        }

        /* ===== 复选框/单选框 ===== */
        QCheckBox, QRadioButton {
            spacing: 8px;
            color: #1d1d1f;
            background: transparent;
        }
        QCheckBox::indicator, QRadioButton::indicator {
            width: 16px;
            height: 16px;
            border: 1px solid #86868b;
            border-radius: 4px;
            background: #ffffff;
        }
        QRadioButton::indicator {
            border-radius: 8px;
        }
        QCheckBox::indicator:checked, QRadioButton::indicator:checked {
            background-color: #1d1d1f;
            border-color: #1d1d1f;
        }

        /* ===== 进度条 ===== */
        QProgressBar {
            background-color: #f5f5f7;
            border: none;
            border-radius: 4px;
            text-align: center;
            color: #1d1d1f;
        }
        QProgressBar::chunk {
            background-color: #1d1d1f;
            border-radius: 4px;
        }

        /* ===== 滚动条 ===== */
        QScrollBar:vertical {
            background: transparent;
            width: 8px;
            margin: 0;
        }
        QScrollBar::handle:vertical {
            background: #d0d0d4;
            border-radius: 4px;
            min-height: 30px;
        }
        QScrollBar::handle:vertical:hover {
            background: #86868b;
        }
        QScrollBar:horizontal {
            background: transparent;
            height: 8px;
            margin: 0;
        }
        QScrollBar::handle:horizontal {
            background: #d0d0d4;
            border-radius: 4px;
            min-width: 30px;
        }
        QScrollBar::handle:horizontal:hover {
            background: #86868b;
        }
        QScrollBar::add-line, QScrollBar::sub-line {
            border: none;
            background: none;
        }

        /* ===== 工具提示 ===== */
        QToolTip {
            background-color: #1d1d1f;
            color: #ffffff;
            border: none;
            border-radius: 6px;
            padding: 6px 10px;
        }
        """
    )


def main() -> int:
    """应用主入口。

    Returns:
        退出码
    """
    _setup_logging()
    logger = logging.getLogger(__name__)
    logger.info("启动 TDSF-Linux Desktop v0.1.0")

    # 创建 QApplication 实例
    app = QApplication(sys.argv)
    app.setApplicationName("TDSF-Linux Desktop")
    app.setApplicationVersion("0.1.0")
    app.setOrganizationName("TDSF")

    # 应用全局样式
    _apply_app_style(app)

    # 创建并显示主窗口
    window = MainWindow()
    window.show()

    logger.info("主窗口已显示，进入事件循环")

    # 进入 Qt 事件循环
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
