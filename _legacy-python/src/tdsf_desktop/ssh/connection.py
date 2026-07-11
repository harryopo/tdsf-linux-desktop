"""SSH连接管理模块。

提供基于paramiko的SSH连接管理功能，支持多连接管理、命令执行和交互式Shell。
适配PySide6信号槽机制，可向UI层通知连接状态变化。
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import paramiko
from PySide6.QtCore import QObject, Signal

logger = logging.getLogger(__name__)

AuthMethod = Literal["password", "key"]


@dataclass
class ServerConfig:
    """SSH服务器连接配置。

    Attributes:
        host: 服务器主机地址
        port: SSH端口，默认22
        username: 登录用户名
        auth_method: 认证方式，'password' 或 'key'
        password: 密码（auth_method为'password'时使用）
        key_path: 私钥文件路径（auth_method为'key'时使用）
        name: 连接名称，便于识别，默认为 username@host:port
        group: 连接分组，便于管理
    """

    host: str
    port: int = 22
    username: str = "root"
    auth_method: AuthMethod = "password"
    password: str | None = None
    key_path: str | None = None
    name: str = ""
    group: str = "默认"


@dataclass
class _ConnectionEntry:
    """内部连接条目，封装SSHClient及其元数据。"""

    client: paramiko.SSHClient
    config: ServerConfig
    created_at: float
    last_used: float
    status: str = "connected"


class SSHConnectionManager(QObject):
    """SSH连接管理器。

    管理多个SSH连接的生命周期，提供命令执行、交互式Shell等功能。
    线程安全：内部使用RLock保护连接字典，可在多线程环境下使用。

    Signals:
        connection_added: 新连接建立时发射，参数为 connection_id
        connection_removed: 连接断开时发射，参数为 connection_id
        status_changed: 连接状态变化时发射，参数为 (connection_id, new_status)
        command_finished: 命令执行完成时发射，参数为 (connection_id, exit_code)
    """

    # PySide6 信号定义
    connection_added = Signal(str)
    connection_removed = Signal(str)
    status_changed = Signal(str, str)
    command_finished = Signal(str, int)

    def __init__(self, parent: QObject | None = None) -> None:
        """初始化SSH连接管理器。

        Args:
            parent: 父QObject对象
        """
        super().__init__(parent)
        self._connections: dict[str, _ConnectionEntry] = {}
        self._lock = threading.RLock()
        self._default_timeout: int = 30

    def connect(
        self,
        host: str,
        port: int,
        username: str,
        auth_method: AuthMethod,
        password: str | None = None,
        key_path: str | None = None,
        name: str = "",
        group: str = "默认",
    ) -> str:
        """建立SSH连接，返回连接ID。

        自动添加host key，支持密码和私钥两种认证方式。

        Args:
            host: 服务器主机地址
            port: SSH端口
            username: 登录用户名
            auth_method: 认证方式，'password' 或 'key'
            password: 密码（密码认证时提供）
            key_path: 私钥文件路径（密钥认证时提供）
            name: 连接名称，为空时自动生成
            group: 连接分组

        Returns:
            connection_id: 连接唯一标识符（UUID）

        Raises:
            ValueError: 参数校验失败（认证方式与凭据不匹配）
            FileNotFoundError: 私钥文件不存在
            ConnectionError: 连接超时、被拒绝或认证失败
            paramiko.SSHException: SSH协议层异常
        """
        # 参数校验
        if auth_method == "password" and not password:
            raise ValueError("密码认证方式需要提供 password 参数")
        if auth_method == "key":
            if not key_path:
                raise ValueError("密钥认证方式需要提供 key_path 参数")
            if not Path(key_path).exists():
                raise FileNotFoundError(f"私钥文件不存在: {key_path}")

        config = ServerConfig(
            host=host,
            port=port,
            username=username,
            auth_method=auth_method,
            password=password,
            key_path=key_path,
            name=name or f"{username}@{host}:{port}",
            group=group,
        )

        logger.info("正在建立SSH连接: %s@%s:%d (%s认证)", username, host, port, auth_method)

        try:
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

            connect_kwargs: dict = {
                "hostname": host,
                "port": port,
                "username": username,
                "timeout": self._default_timeout,
            }

            if auth_method == "key":
                connect_kwargs["key_filename"] = key_path
            else:
                connect_kwargs["password"] = password

            client.connect(**connect_kwargs)
        except paramiko.AuthenticationException as e:
            logger.error("SSH认证失败: %s@%s:%d - %s", username, host, port, e)
            raise ConnectionError(f"SSH认证失败，请检查用户名和凭据: {e}") from e
        except paramiko.SSHException as e:
            logger.error("SSH连接异常: %s@%s:%d - %s", username, host, port, e)
            raise ConnectionError(f"SSH连接异常: {e}") from e
        except OSError as e:
            logger.error("网络连接失败: %s@%s:%d - %s", username, host, port, e)
            raise ConnectionError(f"网络连接失败，请检查主机和端口: {e}") from e

        connection_id = str(uuid.uuid4())
        now = time.time()

        with self._lock:
            self._connections[connection_id] = _ConnectionEntry(
                client=client,
                config=config,
                created_at=now,
                last_used=now,
                status="connected",
            )

        logger.info("SSH连接成功: %s (connection_id=%s)", config.name, connection_id)
        self.connection_added.emit(connection_id)
        self.status_changed.emit(connection_id, "connected")

        return connection_id

    def disconnect(self, connection_id: str) -> None:
        """断开指定SSH连接。

        Args:
            connection_id: 连接唯一标识符

        Raises:
            KeyError: 连接ID不存在
        """
        with self._lock:
            entry = self._connections.get(connection_id)
            if entry is None:
                raise KeyError(f"连接不存在: {connection_id}")

            try:
                entry.client.close()
                logger.info("SSH连接已关闭: %s", entry.config.name)
            except Exception as e:
                logger.warning("关闭SSH连接时出现异常: %s - %s", entry.config.name, e)
            finally:
                entry.status = "disconnected"
                del self._connections[connection_id]

        self.status_changed.emit(connection_id, "disconnected")
        self.connection_removed.emit(connection_id)

    def execute_command(
        self,
        connection_id: str,
        command: str,
        timeout: int | None = None,
    ) -> tuple[int, str, str]:
        """在指定连接上执行SSH命令。

        Args:
            connection_id: 连接唯一标识符
            command: 要执行的命令
            timeout: 命令超时时间（秒），None使用默认超时（30秒）

        Returns:
            (exit_code, stdout, stderr) 三元组

        Raises:
            KeyError: 连接ID不存在
            RuntimeError: 连接已断开或失效
            paramiko.SSHException: 命令执行失败
        """
        entry = self._get_entry(connection_id)
        entry.last_used = time.time()

        effective_timeout = timeout if timeout is not None else self._default_timeout
        logger.info("执行命令 [%s]: %s", entry.config.name, command)

        try:
            stdin, stdout, stderr = entry.client.exec_command(command, timeout=effective_timeout)
            channel = stdout.channel
            channel.settimeout(effective_timeout)

            exit_code: int = channel.recv_exit_status()
            stdout_str = stdout.read().decode("utf-8", errors="replace")
            stderr_str = stderr.read().decode("utf-8", errors="replace")

            logger.info("命令执行完成 [%s]: exit_code=%d", entry.config.name, exit_code)
            self.command_finished.emit(connection_id, exit_code)
            return exit_code, stdout_str, stderr_str
        except paramiko.SSHException as e:
            logger.error("命令执行失败 [%s]: %s - %s", entry.config.name, command, e)
            entry.status = "error"
            self.status_changed.emit(connection_id, "error")
            raise
        except OSError as e:
            logger.error("命令执行异常 [%s]: %s - %s", entry.config.name, command, e)
            raise RuntimeError(f"命令执行异常: {e}") from e

    def open_shell(self, connection_id: str) -> paramiko.Channel:
        """打开交互式Shell通道。

        返回的Channel已配置为交互式终端模式，可直接发送和接收数据。
        调用方负责关闭返回的Channel。

        Args:
            connection_id: 连接唯一标识符

        Returns:
            paramiko.Channel: 交互式Shell通道

        Raises:
            KeyError: 连接ID不存在
            RuntimeError: 连接已断开或失效
            paramiko.SSHException: 打开Shell失败
        """
        entry = self._get_entry(connection_id)
        entry.last_used = time.time()

        logger.info("打开交互式Shell [%s]", entry.config.name)
        try:
            channel = entry.client.invoke_shell()
            channel.settimeout(self._default_timeout)
            return channel
        except paramiko.SSHException as e:
            logger.error("打开Shell失败 [%s]: %s", entry.config.name, e)
            entry.status = "error"
            self.status_changed.emit(connection_id, "error")
            raise

    def get_connection_status(self, connection_id: str) -> str:
        """获取指定连接的状态。

        状态值：
            - 'connected': 已连接
            - 'disconnected': 已断开
            - 'error': 出错

        Args:
            connection_id: 连接唯一标识符

        Returns:
            连接状态字符串

        Raises:
            KeyError: 连接ID不存在
        """
        with self._lock:
            entry = self._connections.get(connection_id)
            if entry is None:
                raise KeyError(f"连接不存在: {connection_id}")

            # 实时检查底层连接是否活跃
            if entry.status == "connected":
                transport = entry.client.get_transport()
                if transport is None or not transport.is_active():
                    entry.status = "disconnected"

            return entry.status

    def list_connections(self) -> list[dict]:
        """列出所有连接的信息。

        Returns:
            连接信息字典列表，每个字典包含：
                - connection_id: 连接ID
                - name: 连接名称
                - host: 主机地址
                - port: 端口
                - username: 用户名
                - group: 分组
                - status: 状态
                - created_at: 创建时间戳
                - last_used: 最后使用时间戳
        """
        with self._lock:
            result = []
            for conn_id, entry in self._connections.items():
                result.append(
                    {
                        "connection_id": conn_id,
                        "name": entry.config.name,
                        "host": entry.config.host,
                        "port": entry.config.port,
                        "username": entry.config.username,
                        "group": entry.config.group,
                        "status": entry.status,
                        "created_at": entry.created_at,
                        "last_used": entry.last_used,
                    }
                )
            return result

    def get_sftp_client(self, connection_id: str) -> paramiko.SFTPClient:
        """从指定连接获取SFTP客户端。

        此方法供SFTPManager使用，每次调用返回新的SFTPClient实例。
        调用方负责关闭返回的SFTPClient。

        Args:
            connection_id: 连接唯一标识符

        Returns:
            paramiko.SFTPClient: SFTP客户端

        Raises:
            KeyError: 连接ID不存在
            RuntimeError: 连接已断开或失效
            paramiko.SSHException: 打开SFTP通道失败
        """
        entry = self._get_entry(connection_id)
        entry.last_used = time.time()

        logger.info("打开SFTP通道 [%s]", entry.config.name)
        try:
            return entry.client.open_sftp()
        except paramiko.SSHException as e:
            logger.error("打开SFTP通道失败 [%s]: %s", entry.config.name, e)
            entry.status = "error"
            self.status_changed.emit(connection_id, "error")
            raise

    def disconnect_all(self) -> None:
        """断开所有连接。"""
        with self._lock:
            conn_ids = list(self._connections.keys())

        for conn_id in conn_ids:
            try:
                self.disconnect(conn_id)
            except Exception as e:
                logger.warning("断开连接 %s 时异常: %s", conn_id, e)

    def _get_entry(self, connection_id: str) -> _ConnectionEntry:
        """获取连接条目（内部方法）。

        Args:
            connection_id: 连接唯一标识符

        Returns:
            _ConnectionEntry: 连接条目

        Raises:
            KeyError: 连接ID不存在
            RuntimeError: 连接已断开或失效
        """
        with self._lock:
            entry = self._connections.get(connection_id)
            if entry is None:
                raise KeyError(f"连接不存在: {connection_id}")

            if entry.status != "connected":
                raise RuntimeError(f"连接已断开: {connection_id} (状态: {entry.status})")

            # 检查底层传输是否活跃
            transport = entry.client.get_transport()
            if transport is None or not transport.is_active():
                entry.status = "disconnected"
                self.status_changed.emit(connection_id, "disconnected")
                raise RuntimeError(f"连接已失效: {connection_id}")

            return entry
