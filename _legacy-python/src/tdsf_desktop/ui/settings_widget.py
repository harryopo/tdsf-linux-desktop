"""设置页面组件。

提供 AI 配置、SSH 默认配置的图形化管理界面：
- API Key 通过 keyring 安全存储到系统钥匙串
- 其他配置保存到 JSON 文件（~/.tdsf-desktop/config.json）
- 支持连接测试与预设快速切换

样式采用苹果极简（黑白灰），卡片式布局，圆角边框。
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import keyring
from PySide6.QtCore import QThread, Signal
from PySide6.QtGui import QFont
from PySide6.QtWidgets import (
    QButtonGroup,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QRadioButton,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

logger = logging.getLogger(__name__)


# ============================================================
# 常量定义
# ============================================================

# keyring 服务标识
_KEYRING_SERVICE = "tdsf-desktop"
_KEYRING_API_KEY = "api_key"

# 配置文件路径
_CONFIG_DIR = Path.home() / ".tdsf-desktop"
_CONFIG_FILE = _CONFIG_DIR / "config.json"

# 默认值
_DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
_DEFAULT_MODEL = "doubao-seed-1-6-250615"
_DEFAULT_SSH_PORT = 22
_DEFAULT_SSH_TIMEOUT = 10

# 主题色（苹果极简：黑白灰）
_THEME_PRIMARY = "#1d1d1f"  # 主色：近黑
_THEME_PRIMARY_LIGHT = "#424245"  # 深灰（hover）
_THEME_PRIMARY_DARK = "#000000"  # 纯黑（按下）
_THEME_CARD_BG = "#ffffff"
_THEME_CARD_BORDER = "#e5e5e7"
_THEME_TEXT_SECONDARY = "#86868b"
_THEME_DANGER = "#c62828"
_THEME_SUCCESS = "#1d1d1f"

# 预设配置
_PRESETS: dict[str, dict[str, str]] = {
    "火山方舟": {
        "base_url": "https://ark.cn-beijing.volces.com/api/v3",
        "model": "doubao-seed-1-6-250615",
    },
    "OpenAI": {
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4o",
    },
}


# ============================================================
# 测试连接线程（避免阻塞 UI）
# ============================================================


class _ConnectionTester(QThread):
    """后台线程：调用 openai 测试连接。

    Signals:
        success: 连接成功，附带响应信息
        failure: 连接失败，附带错误信息
    """

    success = Signal(str)
    failure = Signal(str)

    def __init__(self, api_key: str, base_url: str, model: str) -> None:
        super().__init__()
        self._api_key = api_key
        self._base_url = base_url
        self._model = model

    def run(self) -> None:
        """执行连接测试。"""
        try:
            # 延迟导入，避免无 openai 时整个模块无法加载
            from openai import APIConnectionError, APIError, OpenAI

            if not self._api_key:
                self.failure.emit("API Key 为空，请先填写")
                return

            client = OpenAI(
                api_key=self._api_key,
                base_url=self._base_url,
                timeout=10,
            )
            # 发送极简请求验证可用性
            response = client.chat.completions.create(
                model=self._model,
                messages=[{"role": "user", "content": "ping"}],
                max_tokens=5,
            )
            content = response.choices[0].message.content or "(空响应)"
            self.success.emit(f"连接成功，模型响应：{content[:50]}")
        except APIConnectionError as e:
            self.failure.emit(f"连接失败：{e!s}")
        except APIError as e:
            self.failure.emit(f"API 错误：{e.message}")
        except Exception as e:  # noqa: BLE001 - 兜底处理未知异常
            logger.exception("测试连接发生未知异常")
            self.failure.emit(f"未知错误：{e!s}")


# ============================================================
# 设置页面主组件
# ============================================================


class SettingsWidget(QWidget):
    """设置页面组件。

    提供 AI 配置与 SSH 默认配置的可视化管理。

    Attributes:
        settings_saved: 保存成功信号，附带当前配置字典

    Example:
        >>> widget = SettingsWidget()
        >>> widget.settings_saved.connect(on_saved)
        >>> widget.show()
    """

    settings_saved = Signal(dict)

    def __init__(self, parent: QWidget | None = None) -> None:
        """初始化设置页面。

        Args:
            parent: 父组件
        """
        super().__init__(parent)
        self._tester: _ConnectionTester | None = None
        self._init_ui()
        self._load_settings()

    # ------------------------------------------------------------
    # UI 构建
    # ------------------------------------------------------------

    def _init_ui(self) -> None:
        """构建页面 UI。"""
        # 应用整体样式
        self.setStyleSheet(self._build_stylesheet())

        outer = QVBoxLayout(self)
        outer.setContentsMargins(24, 24, 24, 24)
        outer.setSpacing(16)

        # 页面标题
        title = QLabel("设置")
        title_font = QFont()
        title_font.setPointSize(18)
        title_font.setBold(True)
        title.setFont(title_font)
        outer.addWidget(title)

        # AI 配置卡片
        outer.addWidget(self._build_api_card())

        # SSH 默认配置卡片
        outer.addWidget(self._build_ssh_card())

        # 操作按钮区
        outer.addWidget(self._build_action_bar())

        outer.addStretch(1)

    def _build_api_card(self) -> QFrame:
        """构建 API 配置卡片。"""
        card = QFrame()
        card.setObjectName("card")
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(20, 20, 20, 20)
        card_layout.setSpacing(12)

        # 卡片标题
        header = QLabel("AI 模型配置")
        header_font = QFont()
        header_font.setPointSize(14)
        header_font.setBold(True)
        header.setFont(header_font)
        card_layout.addWidget(header)

        # 表单网格
        form = QGridLayout()
        form.setHorizontalSpacing(12)
        form.setVerticalSpacing(10)
        form.setColumnStretch(1, 1)

        # API Key
        api_key_label = QLabel("API Key")
        api_key_row = QHBoxLayout()
        self.api_key_edit = QLineEdit()
        self.api_key_edit.setEchoMode(QLineEdit.EchoMode.Password)
        self.api_key_edit.setPlaceholderText("请输入 API Key")
        self.show_key_btn = QPushButton("显示")
        self.show_key_btn.setCheckable(True)
        self.show_key_btn.setFixedWidth(60)
        self.show_key_btn.clicked.connect(self._on_toggle_api_key_visible)
        api_key_row.addWidget(self.api_key_edit)
        api_key_row.addWidget(self.show_key_btn)
        form.addWidget(api_key_label, 0, 0)
        form.addLayout(api_key_row, 0, 1)

        # Base URL
        base_url_label = QLabel("Base URL")
        self.base_url_edit = QLineEdit()
        self.base_url_edit.setPlaceholderText("API 基础地址")
        form.addWidget(base_url_label, 1, 0)
        form.addWidget(self.base_url_edit, 1, 1)

        # 模型名
        model_label = QLabel("模型名")
        self.model_edit = QLineEdit()
        self.model_edit.setPlaceholderText("模型标识")
        form.addWidget(model_label, 2, 0)
        form.addWidget(self.model_edit, 2, 1)

        card_layout.addLayout(form)

        # 预设按钮
        preset_row = QHBoxLayout()
        preset_row.setSpacing(8)
        preset_label = QLabel("快速预设")
        preset_label.setStyleSheet(f"color: {_THEME_TEXT_SECONDARY};")
        preset_row.addWidget(preset_label)

        self.preset_volcano_btn = QPushButton("火山方舟")
        self.preset_volcano_btn.clicked.connect(lambda: self._apply_preset("火山方舟"))
        preset_row.addWidget(self.preset_volcano_btn)

        self.preset_openai_btn = QPushButton("OpenAI")
        self.preset_openai_btn.clicked.connect(lambda: self._apply_preset("OpenAI"))
        preset_row.addWidget(self.preset_openai_btn)

        self.preset_custom_btn = QPushButton("自定义")
        self.preset_custom_btn.clicked.connect(self._apply_custom_preset)
        preset_row.addWidget(self.preset_custom_btn)

        preset_row.addStretch(1)
        card_layout.addLayout(preset_row)

        # 测试连接按钮 + 状态
        test_row = QHBoxLayout()
        test_row.setSpacing(10)
        self.test_btn = QPushButton("测试连接")
        self.test_btn.setObjectName("primaryBtn")
        self.test_btn.clicked.connect(self._test_connection)
        test_row.addWidget(self.test_btn)

        self.connection_status_label = QLabel("")
        self.connection_status_label.setWordWrap(True)
        test_row.addWidget(self.connection_status_label, 1)
        card_layout.addLayout(test_row)

        return card

    def _build_ssh_card(self) -> QFrame:
        """构建 SSH 默认配置卡片。"""
        card = QFrame()
        card.setObjectName("card")
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(20, 20, 20, 20)
        card_layout.setSpacing(12)

        header = QLabel("SSH 默认配置")
        header_font = QFont()
        header_font.setPointSize(14)
        header_font.setBold(True)
        header.setFont(header_font)
        card_layout.addWidget(header)

        form = QGridLayout()
        form.setHorizontalSpacing(12)
        form.setVerticalSpacing(10)
        form.setColumnStretch(1, 1)

        # 默认端口
        port_label = QLabel("默认端口")
        self.ssh_port_spin = QSpinBox()
        self.ssh_port_spin.setRange(1, 65535)
        self.ssh_port_spin.setValue(_DEFAULT_SSH_PORT)
        form.addWidget(port_label, 0, 0)
        form.addWidget(self.ssh_port_spin, 0, 1)

        # 认证方式
        auth_label = QLabel("认证方式")
        auth_row = QHBoxLayout()
        self.auth_group = QButtonGroup(self)
        self.auth_password_radio = QRadioButton("密码")
        self.auth_key_radio = QRadioButton("私钥")
        self.auth_password_radio.setChecked(True)
        self.auth_group.addButton(self.auth_password_radio)
        self.auth_group.addButton(self.auth_key_radio)
        auth_row.addWidget(self.auth_password_radio)
        auth_row.addWidget(self.auth_key_radio)
        auth_row.addStretch(1)
        form.addWidget(auth_label, 1, 0)
        form.addLayout(auth_row, 1, 1)

        # 超时时间
        timeout_label = QLabel("超时时间(秒)")
        self.ssh_timeout_spin = QSpinBox()
        self.ssh_timeout_spin.setRange(1, 300)
        self.ssh_timeout_spin.setValue(_DEFAULT_SSH_TIMEOUT)
        form.addWidget(timeout_label, 2, 0)
        form.addWidget(self.ssh_timeout_spin, 2, 1)

        card_layout.addLayout(form)
        return card

    def _build_action_bar(self) -> QWidget:
        """构建底部操作按钮区。"""
        bar = QWidget()
        layout = QHBoxLayout(bar)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addStretch(1)

        self.save_btn = QPushButton("保存设置")
        self.save_btn.setObjectName("primaryBtn")
        self.save_btn.setMinimumWidth(120)
        self.save_btn.clicked.connect(self._save_settings)
        layout.addWidget(self.save_btn)

        return bar

    # ------------------------------------------------------------
    # 配置加载与保存
    # ------------------------------------------------------------

    def _load_settings(self) -> None:
        """从 keyring 与 JSON 文件加载配置到 UI。"""
        # API Key 从 keyring 读取
        try:
            api_key = keyring.get_password(_KEYRING_SERVICE, _KEYRING_API_KEY) or ""
        except Exception:  # noqa: BLE001 - 某些后端可能不可用
            logger.exception("从 keyring 读取 API Key 失败")
            api_key = ""
        self.api_key_edit.setText(api_key)

        # 其他配置从 JSON 读取
        config = self._read_config_file()
        self.base_url_edit.setText(config.get("base_url", _DEFAULT_BASE_URL))
        self.model_edit.setText(config.get("model", _DEFAULT_MODEL))
        self.ssh_port_spin.setValue(int(config.get("ssh_port", _DEFAULT_SSH_PORT)))
        self.ssh_timeout_spin.setValue(
            int(config.get("ssh_timeout", _DEFAULT_SSH_TIMEOUT))
        )
        auth_method = config.get("ssh_auth_method", "password")
        if auth_method == "key":
            self.auth_key_radio.setChecked(True)
        else:
            self.auth_password_radio.setChecked(True)

    def _save_settings(self) -> None:
        """保存配置：API Key 入 keyring，其他入 JSON。"""
        # 保存 API Key 到 keyring
        api_key = self.api_key_edit.text().strip()
        try:
            if api_key:
                keyring.set_password(_KEYRING_SERVICE, _KEYRING_API_KEY, api_key)
            else:
                # 清空场景：删除凭据
                import contextlib

                with contextlib.suppress(keyring.errors.PasswordDeleteError):
                    keyring.delete_password(_KEYRING_SERVICE, _KEYRING_API_KEY)
        except Exception:  # noqa: BLE001
            logger.exception("保存 API Key 到 keyring 失败")
            self._show_status("保存失败：无法写入系统钥匙串", error=True)
            return

        # 保存其他配置到 JSON
        config: dict[str, Any] = {
            "base_url": self.base_url_edit.text().strip() or _DEFAULT_BASE_URL,
            "model": self.model_edit.text().strip() or _DEFAULT_MODEL,
            "ssh_port": self.ssh_port_spin.value(),
            "ssh_timeout": self.ssh_timeout_spin.value(),
            "ssh_auth_method": "key" if self.auth_key_radio.isChecked() else "password",
        }
        try:
            _CONFIG_DIR.mkdir(parents=True, exist_ok=True)
            _CONFIG_FILE.write_text(
                json.dumps(config, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except OSError as e:
            logger.exception("写入配置文件失败")
            self._show_status(f"保存失败：{e!s}", error=True)
            return

        self._show_status("保存成功", error=False)
        self.settings_saved.emit(config)

    # ------------------------------------------------------------
    # 测试连接
    # ------------------------------------------------------------

    def _test_connection(self) -> None:
        """触发后台连接测试。"""
        # 防止重复点击
        if self._tester is not None and self._tester.isRunning():
            return

        api_key = self.api_key_edit.text().strip()
        base_url = self.base_url_edit.text().strip() or _DEFAULT_BASE_URL
        model = self.model_edit.text().strip() or _DEFAULT_MODEL

        # 进入 loading 状态
        self.test_btn.setEnabled(False)
        self.test_btn.setText("测试中...")
        self._show_status("正在测试连接...", error=False)

        self._tester = _ConnectionTester(api_key, base_url, model)
        self._tester.success.connect(self._on_test_success)
        self._tester.failure.connect(self._on_test_failure)
        self._tester.finished.connect(self._on_test_finished)
        self._tester.start()

    def _on_test_success(self, message: str) -> None:
        """测试成功回调。"""
        self._show_status(f"✓ {message}", error=False)

    def _on_test_failure(self, message: str) -> None:
        """测试失败回调。"""
        self._show_status(f"✗ {message}", error=True)

    def _on_test_finished(self) -> None:
        """测试结束回调（无论成功失败）。"""
        self.test_btn.setEnabled(True)
        self.test_btn.setText("测试连接")
        # 清理引用
        if self._tester is not None:
            self._tester.deleteLater()
            self._tester = None

    # ------------------------------------------------------------
    # 预设与交互
    # ------------------------------------------------------------

    def _apply_preset(self, name: str) -> None:
        """应用预设配置。

        Args:
            name: 预设名称（火山方舟 / OpenAI）
        """
        preset = _PRESETS.get(name)
        if preset is None:
            return
        self.base_url_edit.setText(preset["base_url"])
        self.model_edit.setText(preset["model"])
        self._show_status(f"已应用预设：{name}", error=False)

    def _apply_custom_preset(self) -> None:
        """自定义预设：清空 Base URL 与模型名，便于用户填写。"""
        self.base_url_edit.clear()
        self.model_edit.clear()
        self.base_url_edit.setFocus()
        self._show_status("已切换到自定义模式，请手动填写", error=False)

    def _on_toggle_api_key_visible(self) -> None:
        """切换 API Key 显示/隐藏。"""
        if self.show_key_btn.isChecked():
            self.api_key_edit.setEchoMode(QLineEdit.EchoMode.Normal)
            self.show_key_btn.setText("隐藏")
        else:
            self.api_key_edit.setEchoMode(QLineEdit.EchoMode.Password)
            self.show_key_btn.setText("显示")

    # ------------------------------------------------------------
    # 辅助方法
    # ------------------------------------------------------------

    def _show_status(self, message: str, *, error: bool) -> None:
        """在连接状态标签上显示信息。

        Args:
            message: 显示文本
            error: 是否为错误信息
        """
        color = _THEME_DANGER if error else _THEME_SUCCESS
        self.connection_status_label.setStyleSheet(f"color: {color};")
        self.connection_status_label.setText(message)

    @staticmethod
    def _read_config_file() -> dict[str, Any]:
        """读取 JSON 配置文件。

        Returns:
            配置字典，文件不存在或损坏时返回空字典
        """
        if not _CONFIG_FILE.exists():
            return {}
        try:
            return json.loads(_CONFIG_FILE.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            logger.exception("读取配置文件失败")
            return {}

    @staticmethod
    def _build_stylesheet() -> str:
        """构建全局 QSS 样式表。"""
        return f"""
        QWidget#card {{
            background-color: {_THEME_CARD_BG};
            border: 1px solid {_THEME_CARD_BORDER};
            border-radius: 10px;
        }}
        QLabel {{
            color: #1d1d1f;
        }}
        QLineEdit {{
            padding: 6px 8px;
            border: 1px solid {_THEME_CARD_BORDER};
            border-radius: 8px;
            background-color: #f5f5f7;
            selection-background-color: {_THEME_PRIMARY_LIGHT};
        }}
        QLineEdit:focus {{
            border: 1px solid {_THEME_PRIMARY};
            background-color: #ffffff;
        }}
        QPushButton {{
            padding: 6px 14px;
            border: 1px solid {_THEME_CARD_BORDER};
            border-radius: 8px;
            background-color: #f5f5f7;
            color: #1d1d1f;
        }}
        QPushButton:hover {{
            background-color: #e8e8ed;
            border-color: #d0d0d4;
        }}
        QPushButton:pressed {{
            background-color: #d0d0d4;
        }}
        QPushButton#primaryBtn {{
            background-color: {_THEME_PRIMARY};
            color: #ffffff;
            border: 1px solid {_THEME_PRIMARY};
            font-weight: 500;
        }}
        QPushButton#primaryBtn:hover {{
            background-color: {_THEME_PRIMARY_LIGHT};
            border-color: {_THEME_PRIMARY_LIGHT};
        }}
        QPushButton#primaryBtn:pressed {{
            background-color: {_THEME_PRIMARY_DARK};
            border-color: {_THEME_PRIMARY_DARK};
        }}
        QPushButton#primaryBtn:disabled {{
            background-color: #d0d0d4;
            border-color: #d0d0d4;
            color: #f5f5f7;
        }}
        QSpinBox {{
            padding: 6px 8px;
            border: 1px solid {_THEME_CARD_BORDER};
            border-radius: 8px;
            background-color: #f5f5f7;
        }}
        QSpinBox:focus {{
            border: 1px solid {_THEME_PRIMARY};
            background-color: #ffffff;
        }}
        QRadioButton {{
            spacing: 8px;
        }}
        QRadioButton::indicator {{
            width: 16px;
            height: 16px;
        }}
        QRadioButton::indicator:checked {{
            background-color: {_THEME_PRIMARY};
            border: 2px solid #ffffff;
            border-radius: 8px;
        }}
        """
