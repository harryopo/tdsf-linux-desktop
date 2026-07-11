"""SSH 终端组件。

基于 PySide6 + paramiko + pyte 实现的交互式 SSH 终端：
- 使用 pyte.Screen + pyte.Stream 解析 ANSI 转义序列
- TerminalWorker 后台线程循环读取 channel.recv() 输出
- 捕获键盘事件转换为 ANSI 序列发送到 channel.send()
- 黑色背景等宽字体，支持光标显示与滚动条自动跟随

Example:
    >>> widget = TerminalWidget()
    >>> widget.set_channel(ssh_channel)
    >>> widget.show()
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

import pyte
from PySide6.QtCore import QObject, Qt, QThread, Signal, Slot
from PySide6.QtGui import QFont, QKeyEvent, QTextCursor
from PySide6.QtWidgets import (
    QPlainTextEdit,
    QVBoxLayout,
    QWidget,
)

if TYPE_CHECKING:
    import paramiko

logger = logging.getLogger(__name__)


# ============================================================
# 常量定义
# ============================================================

# 终端尺寸（列数 × 行数）
_TERMINAL_COLUMNS = 80
_TERMINAL_LINES = 24

# 主题色
_THEME_BG = "#1e1e1e"  # 背景：VSCode 暗色
_THEME_FG = "#d4d4d4"  # 前景：浅灰白

# 字体配置
_FONT_FAMILY = "Consolas"  # Windows 默认；macOS 自动回退 Monaco
_FONT_SIZE = 14


# ============================================================
# 后台读取线程
# ============================================================


class TerminalWorker(QThread):
    """后台线程：循环读取 SSH channel 输出。

    在独立线程中阻塞调用 ``channel.recv()``，避免阻塞 UI 主线程。
    收到数据后通过 ``output_received`` 信号发射到主线程渲染。

    Signals:
        output_received: 收到 channel 输出，参数为原始字节串解码后的字符串
        connection_lost: channel 已关闭或读取异常，参数为原因说明
    """

    output_received = Signal(str)
    connection_lost = Signal(str)

    def __init__(self, channel: paramiko.Channel, parent: QObject | None = None) -> None:
        """初始化终端读取线程。

        Args:
            channel: 已打开的 SSH 交互式 Shell 通道
            parent: 父 QObject
        """
        super().__init__(parent)
        self._channel = channel
        self._running = True

    def run(self) -> None:
        """线程主循环：阻塞读取 channel 输出直到通道关闭。"""
        try:
            while self._running:
                # 阻塞读取；channel 关闭时 recv 返回空字节串
                try:
                    data = self._channel.recv(4096)
                except OSError as e:
                    # 通道被关闭时 paramiko 会抛 OSError
                    logger.debug("channel recv 异常: %s", e)
                    break

                if not data:
                    # 空数据表示通道已关闭
                    break

                try:
                    text = data.decode("utf-8", errors="replace")
                except Exception as e:  # noqa: BLE001 - 兜底解码异常
                    logger.warning("解码 channel 输出失败: %s", e)
                    text = data.decode("latin-1", errors="replace")

                self.output_received.emit(text)

            self.connection_lost.emit("SSH 通道已关闭")
        except Exception as e:  # noqa: BLE001 - 防止线程异常导致崩溃
            logger.exception("TerminalWorker 运行异常")
            self.connection_lost.emit(f"终端读取异常: {e}")

    def stop(self) -> None:
        """请求停止线程（非阻塞，由调用方等待 quit/wait）。"""
        self._running = False


# ============================================================
# 终端组件
# ============================================================


class TerminalWidget(QWidget):
    """SSH 交互式终端组件。

    负责：渲染 pyte 解析后的屏幕内容、捕获键盘输入发送到 SSH channel、
    管理后台读取线程的生命周期。

    Attributes:
        connection_lost: 连接断开信号，参数为原因说明
    """

    connection_lost = Signal(str)

    def __init__(self, parent: QWidget | None = None) -> None:
        """初始化终端组件。

        Args:
            parent: 父组件
        """
        super().__init__(parent)

        # SSH 通道与后台线程
        self._channel: paramiko.Channel | None = None
        self._worker: TerminalWorker | None = None

        # pyte 屏幕与流解析器
        self._screen = pyte.Screen(_TERMINAL_COLUMNS, _TERMINAL_LINES)
        self._stream = pyte.Stream(self._screen)

        # 初始化 UI
        self._init_ui()

    # ------------------------------------------------------------
    # UI 构建
    # ------------------------------------------------------------

    def _init_ui(self) -> None:
        """构建终端 UI。"""
        # 应用整体样式
        self.setStyleSheet(
            f"QWidget {{ background-color: {_THEME_BG}; }}"
        )

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # 终端显示区域：使用 QPlainTextEdit 性能更好
        self._text_edit = QPlainTextEdit()
        self._text_edit.setReadOnly(True)
        self._text_edit.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
        # 让该控件成为本 Widget 的焦点代理，键盘事件由父组件转发
        self.setFocusProxy(self._text_edit)

        # 等宽字体
        font = QFont(_FONT_FAMILY, _FONT_SIZE)
        font.setStyleHint(QFont.StyleHint.Monospace)
        self._text_edit.setFont(font)

        # 终端样式
        self._text_edit.setStyleSheet(
            f"""
            QPlainTextEdit {{
                background-color: {_THEME_BG};
                color: {_THEME_FG};
                border: none;
                padding: 8px;
            }}
            """
        )
        # 不显示滚动条周边装饰，保留垂直滚动条
        self._text_edit.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        self._text_edit.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        # 关闭自动换行，让 pyte 控制换行
        self._text_edit.setLineWrapMode(QPlainTextEdit.LineWrapMode.NoWrap)

        layout.addWidget(self._text_edit)

        # 初始渲染空屏幕
        self._render_screen()

    # ------------------------------------------------------------
    # 连接管理
    # ------------------------------------------------------------

    def set_channel(self, channel: paramiko.Channel) -> None:
        """绑定 SSH channel 并启动后台读取线程。

        Args:
            channel: 已打开的 SSH 交互式 Shell 通道
        """
        # 若已有连接，先清理
        if self._worker is not None or self._channel is not None:
            self.disconnect()

        self._channel = channel

        # 启动后台读取线程
        self._worker = TerminalWorker(channel, self)
        self._worker.output_received.connect(self._on_output)
        self._worker.connection_lost.connect(self._on_connection_lost)
        self._worker.start()

        logger.info("终端已绑定 SSH channel 并启动读取线程")

    @Slot(str)
    def _on_output(self, text: str) -> None:
        """处理 SSH 输出：喂给 pyte 解析后重新渲染屏幕。

        Args:
            text: 从 channel 收到的文本
        """
        # 喂给 pyte 流解析器
        self._stream.feed(text)
        # 重新渲染整个屏幕
        self._render_screen()

    @Slot(str)
    def _on_connection_lost(self, reason: str) -> None:
        """连接断开回调。

        Args:
            reason: 断开原因
        """
        logger.info("终端连接断开: %s", reason)
        self.connection_lost.emit(reason)

    # ------------------------------------------------------------
    # 屏幕渲染
    # ------------------------------------------------------------

    def _render_screen(self) -> None:
        """将 pyte 屏幕内容渲染到 QPlainTextEdit。

        遍历 pyte.Screen 的 display 属性，按行拼接后设置文本，
        并把光标移动到对应位置。
        """
        # display 是按行切分的字符串列表（已处理制表符等）
        lines = self._screen.display
        text = "\n".join(lines)

        cursor = self._text_edit.textCursor()
        # 记录当前滚动位置，避免用户向上滚动时被强制拉到底
        scrollbar = self._text_edit.verticalScrollBar()
        at_bottom = scrollbar.value() >= scrollbar.maximum() - 2

        # 保存用户选区
        saved_selection_start = cursor.selectionStart()
        saved_selection_end = cursor.selectionEnd()

        # 全选并替换为最新内容
        cursor.select(QTextCursor.SelectionType.Document)
        cursor.insertText(text)

        # 恢复选区（若有）
        if saved_selection_start != saved_selection_end:
            new_cursor = self._text_edit.textCursor()
            new_cursor.setPosition(saved_selection_start)
            new_cursor.setPosition(saved_selection_end, QTextCursor.MoveMode.KeepAnchor)
            self._text_edit.setTextCursor(new_cursor)

        # 移动光标到 pyte 记录的光标位置
        self._move_cursor_to_pyte()

        # 滚动到底部（仅当原本就在底部时）
        if at_bottom:
            scrollbar.setValue(scrollbar.maximum())

    def _move_cursor_to_pyte(self) -> None:
        """把文本光标移动到 pyte 屏幕记录的光标位置。

        注：QPlainTextEdit 在 readOnly 模式下不显示文本光标，
        这里仅同步光标位置以便后续扩展（如绘制光标块）。
        """
        cursor_y = self._screen.cursor.y
        cursor_x = self._screen.cursor.x

        text_cursor = self._text_edit.textCursor()
        # 定位到对应行
        text_cursor.movePosition(QTextCursor.MoveOperation.Start)
        for _ in range(max(0, cursor_y)):
            text_cursor.movePosition(QTextCursor.MoveOperation.Down)
        # 定位到对应列
        for _ in range(max(0, cursor_x)):
            text_cursor.movePosition(QTextCursor.MoveOperation.Right)
        self._text_edit.setTextCursor(text_cursor)

    # ------------------------------------------------------------
    # 键盘输入
    # ------------------------------------------------------------

    def keyPressEvent(self, event: QKeyEvent) -> None:  # noqa: N802 - Qt 命名约定
        """捕获键盘事件，转换为 ANSI 序列发送到 SSH channel。

        Args:
            event: 键盘事件
        """
        if self._channel is None:
            return

        data = self._key_event_to_ansi(event)
        if data is None:
            # 不识别的键交给父类处理
            super().keyPressEvent(event)
            return

        try:
            if isinstance(data, str):
                self._channel.sendall(data.encode("utf-8"))
            else:
                self._channel.sendall(data)
        except OSError as e:
            logger.warning("发送键盘输入到 channel 失败: %s", e)

    def _key_event_to_ansi(self, event: QKeyEvent) -> str | None:
        """将 Qt 键盘事件映射为 ANSI 转义序列或字面字符。

        Args:
            event: 键盘事件

        Returns:
            ANSI 序列字符串；若不识别则返回 None
        """
        key = event.key()
        modifiers = event.modifiers()

        # ----- 特殊键映射 -----
        # Ctrl+C = \x03, Ctrl+D = \x04 等控制字符
        if modifiers & Qt.KeyboardModifier.ControlModifier:
            ctrl_map = {
                Qt.Key.Key_A: "\x01",
                Qt.Key.Key_B: "\x02",
                Qt.Key.Key_C: "\x03",
                Qt.Key.Key_D: "\x04",
                Qt.Key.Key_E: "\x05",
                Qt.Key.Key_F: "\x06",
                Qt.Key.Key_G: "\x07",
                Qt.Key.Key_H: "\x08",
                Qt.Key.Key_I: "\x09",
                Qt.Key.Key_J: "\x0a",
                Qt.Key.Key_K: "\x0b",
                Qt.Key.Key_L: "\x0c",
                Qt.Key.Key_M: "\x0d",
                Qt.Key.Key_N: "\x0e",
                Qt.Key.Key_O: "\x0f",
                Qt.Key.Key_P: "\x10",
                Qt.Key.Key_Q: "\x11",
                Qt.Key.Key_R: "\x12",
                Qt.Key.Key_S: "\x13",
                Qt.Key.Key_T: "\x14",
                Qt.Key.Key_U: "\x15",
                Qt.Key.Key_V: "\x16",
                Qt.Key.Key_W: "\x17",
                Qt.Key.Key_X: "\x18",
                Qt.Key.Key_Y: "\x19",
                Qt.Key.Key_Z: "\x1a",
                Qt.Key.Key_BracketLeft: "\x1b",  # ESC
                Qt.Key.Key_4: "\x1c",  # Ctrl+\
                Qt.Key.Key_5: "\x1d",
                Qt.Key.Key_6: "\x1e",
                Qt.Key.Key_7: "\x1f",
                Qt.Key.Key_Space: "\x00",
            }
            seq: str | None = ctrl_map.get(key)
            if seq is not None:
                return seq
            return None

        # ----- 功能键 -----
        if key == Qt.Key.Key_Return or key == Qt.Key.Key_Enter:
            return "\r"
        if key == Qt.Key.Key_Backspace:
            return "\x7f"
        if key == Qt.Key.Key_Tab:
            return "\t"
        if key == Qt.Key.Key_Escape:
            return "\x1b"

        # 方向键
        if key == Qt.Key.Key_Up:
            return "\x1b[A"
        if key == Qt.Key.Key_Down:
            return "\x1b[B"
        if key == Qt.Key.Key_Right:
            return "\x1b[C"
        if key == Qt.Key.Key_Left:
            return "\x1b[D"

        # Home / End / PageUp / PageDown / Insert / Delete
        if key == Qt.Key.Key_Home:
            return "\x1b[H"
        if key == Qt.Key.Key_End:
            return "\x1b[F"
        if key == Qt.Key.Key_PageUp:
            return "\x1b[5~"
        if key == Qt.Key.Key_PageDown:
            return "\x1b[6~"
        if key == Qt.Key.Key_Insert:
            return "\x1b[2~"
        if key == Qt.Key.Key_Delete:
            return "\x1b[3~"

        # ----- 普通可打印字符 -----
        text = event.text()
        if text:
            return text

        return None

    # ------------------------------------------------------------
    # 断开与清理
    # ------------------------------------------------------------

    def disconnect(self) -> None:
        """断开 SSH 连接并清理资源。

        停止后台读取线程、关闭 channel，重置组件状态以便复用。
        """
        # 停止后台线程
        if self._worker is not None:
            self._worker.stop()
            self._worker.wait(2000)  # 最多等待 2 秒
            self._worker.deleteLater()
            self._worker = None

        # 关闭 channel
        if self._channel is not None:
            try:
                if not self._channel.closed:
                    self._channel.close()
            except Exception as e:  # noqa: BLE001 - 关闭异常可忽略
                logger.debug("关闭 channel 异常: %s", e)
            self._channel = None

        logger.info("终端已断开连接并清理资源")

    def closeEvent(self, event) -> None:  # noqa: N802 - Qt 命名约定
        """窗口关闭时清理资源。

        Args:
            event: 关闭事件
        """
        self.disconnect()
        super().closeEvent(event)
