"""SFTP文件管理模块。

提供基于paramiko的SFTP文件操作功能，支持目录浏览、上传下载、文件预览等。
通过SSHConnectionManager获取SFTPClient，每次操作独立创建和关闭SFTPClient。
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from PySide6.QtCore import QObject, Signal

if TYPE_CHECKING:
    from .connection import SSHConnectionManager

logger = logging.getLogger(__name__)


@dataclass
class RemoteFile:
    """远程文件信息。

    Attributes:
        name: 文件名
        size: 文件大小（字节）
        is_dir: 是否为目录
        permissions: 权限字符串（如 'drwxr-xr-x'）
        modify_time: 修改时间戳（Unix时间戳）
    """

    name: str
    size: int
    is_dir: bool
    permissions: str
    modify_time: float


class SFTPManager(QObject):
    """SFTP文件管理器。

    基于SSH连接提供SFTP文件操作功能。每个操作方法内部创建并关闭SFTPClient，
    调用方无需关心SFTPClient的生命周期管理。

    Signals:
        upload_progress: 上传进度，参数为 (connection_id, sent_bytes, total_bytes)
        download_progress: 下载进度，参数为 (connection_id, received_bytes, total_bytes)
        operation_completed: 操作完成，参数为 (connection_id, operation, remote_path)
    """

    # PySide6 信号定义
    upload_progress = Signal(str, int, int)
    download_progress = Signal(str, int, int)
    operation_completed = Signal(str, str, str)

    def __init__(
        self,
        ssh_manager: SSHConnectionManager,
        parent: QObject | None = None,
    ) -> None:
        """初始化SFTP管理器。

        Args:
            ssh_manager: SSH连接管理器实例，用于获取SFTPClient
            parent: 父QObject对象
        """
        super().__init__(parent)
        self._ssh_manager = ssh_manager

    def list_dir(self, connection_id: str, remote_path: str) -> list[RemoteFile]:
        """列出远程目录内容。

        Args:
            connection_id: 连接唯一标识符
            remote_path: 远程目录路径

        Returns:
            RemoteFile列表，目录排在前面，同类按名称排序

        Raises:
            KeyError: 连接ID不存在
            IOError: 远程目录不存在或无法访问
            paramiko.SFTPError: SFTP操作失败
        """
        logger.info("列出目录 [%s]: %s", connection_id, remote_path)

        sftp = self._ssh_manager.get_sftp_client(connection_id)
        try:
            entries = sftp.listdir_attr(remote_path)
            result: list[RemoteFile] = []
            for attr in entries:
                is_dir = bool(attr.st_mode and (attr.st_mode & 0o170000) == 0o040000)
                permissions = self._mode_to_permissions(attr.st_mode or 0)
                result.append(
                    RemoteFile(
                        name=attr.filename,
                        size=attr.st_size or 0,
                        is_dir=is_dir,
                        permissions=permissions,
                        modify_time=attr.st_mtime or 0.0,
                    )
                )
            # 目录排前面，然后按名称排序
            result.sort(key=lambda f: (not f.is_dir, f.name.lower()))
            logger.info("列出目录完成 [%s]: %s (%d项)", connection_id, remote_path, len(result))
            self.operation_completed.emit(connection_id, "list_dir", remote_path)
            return result
        except OSError as e:
            logger.error("列出目录失败 [%s]: %s - %s", connection_id, remote_path, e)
            raise OSError(f"无法访问远程目录 '{remote_path}': {e}") from e
        finally:
            sftp.close()

    def upload_file(
        self,
        connection_id: str,
        local_path: str,
        remote_path: str,
    ) -> None:
        """上传本地文件到远程。

        Args:
            connection_id: 连接唯一标识符
            local_path: 本地文件路径
            remote_path: 远程目标路径

        Raises:
            KeyError: 连接ID不存在
            FileNotFoundError: 本地文件不存在
            IOError: 远程写入失败
            paramiko.SFTPError: SFTP操作失败
        """
        if not Path(local_path).exists():
            raise FileNotFoundError(f"本地文件不存在: {local_path}")

        file_size = os.path.getsize(local_path)
        logger.info(
            "上传文件 [%s]: %s -> %s (%d字节)",
            connection_id,
            local_path,
            remote_path,
            file_size,
        )

        sftp = self._ssh_manager.get_sftp_client(connection_id)
        sent_bytes = 0
        try:

            def _callback(transferred: int, total: int) -> None:
                """上传进度回调，节流发射信号。"""
                nonlocal sent_bytes
                # 只在增量变化达到阈值或完成时发射信号，避免信号过于频繁
                threshold = max(total // 100, 1024)
                if transferred - sent_bytes >= threshold or transferred == total:
                    sent_bytes = transferred
                    self.upload_progress.emit(connection_id, transferred, total)

            sftp.put(local_path, remote_path, callback=_callback)
            logger.info("上传文件完成 [%s]: %s", connection_id, remote_path)
            self.operation_completed.emit(connection_id, "upload", remote_path)
        except OSError as e:
            logger.error("上传文件失败 [%s]: %s - %s", connection_id, remote_path, e)
            raise OSError(f"上传文件失败: {e}") from e
        finally:
            sftp.close()

    def download_file(
        self,
        connection_id: str,
        remote_path: str,
        local_path: str,
    ) -> None:
        """下载远程文件到本地。

        Args:
            connection_id: 连接唯一标识符
            remote_path: 远程文件路径
            local_path: 本地目标路径

        Raises:
            KeyError: 连接ID不存在
            IOError: 远程文件不存在或本地写入失败
            paramiko.SFTPError: SFTP操作失败
        """
        logger.info("下载文件 [%s]: %s -> %s", connection_id, remote_path, local_path)

        # 确保本地目录存在
        local_dir = Path(local_path).parent
        local_dir.mkdir(parents=True, exist_ok=True)

        sftp = self._ssh_manager.get_sftp_client(connection_id)
        received_bytes = 0
        try:

            def _callback(transferred: int, total: int) -> None:
                """下载进度回调，节流发射信号。"""
                nonlocal received_bytes
                threshold = max(total // 100, 1024)
                if transferred - received_bytes >= threshold or transferred == total:
                    received_bytes = transferred
                    self.download_progress.emit(connection_id, transferred, total)

            sftp.get(remote_path, local_path, callback=_callback)
            logger.info("下载文件完成 [%s]: %s", connection_id, local_path)
            self.operation_completed.emit(connection_id, "download", remote_path)
        except OSError as e:
            logger.error("下载文件失败 [%s]: %s - %s", connection_id, remote_path, e)
            raise OSError(f"下载文件失败: {e}") from e
        finally:
            sftp.close()

    def delete_file(self, connection_id: str, remote_path: str) -> None:
        """删除远程文件。

        Args:
            connection_id: 连接唯一标识符
            remote_path: 远程文件路径

        Raises:
            KeyError: 连接ID不存在
            IOError: 远程文件不存在或删除失败
            paramiko.SFTPError: SFTP操作失败
        """
        logger.info("删除文件 [%s]: %s", connection_id, remote_path)

        sftp = self._ssh_manager.get_sftp_client(connection_id)
        try:
            sftp.remove(remote_path)
            logger.info("删除文件完成 [%s]: %s", connection_id, remote_path)
            self.operation_completed.emit(connection_id, "delete", remote_path)
        except OSError as e:
            logger.error("删除文件失败 [%s]: %s - %s", connection_id, remote_path, e)
            raise OSError(f"删除文件失败 '{remote_path}': {e}") from e
        finally:
            sftp.close()

    def make_dir(self, connection_id: str, remote_path: str) -> None:
        """在远程创建目录。

        Args:
            connection_id: 连接唯一标识符
            remote_path: 远程目录路径

        Raises:
            KeyError: 连接ID不存在
            IOError: 目录创建失败（如已存在或权限不足）
            paramiko.SFTPError: SFTP操作失败
        """
        logger.info("创建目录 [%s]: %s", connection_id, remote_path)

        sftp = self._ssh_manager.get_sftp_client(connection_id)
        try:
            sftp.mkdir(remote_path)
            logger.info("创建目录完成 [%s]: %s", connection_id, remote_path)
            self.operation_completed.emit(connection_id, "mkdir", remote_path)
        except OSError as e:
            logger.error("创建目录失败 [%s]: %s - %s", connection_id, remote_path, e)
            raise OSError(f"创建目录失败 '{remote_path}': {e}") from e
        finally:
            sftp.close()

    def get_file_content(
        self,
        connection_id: str,
        remote_path: str,
        max_size: int = 1024 * 1024,
    ) -> str:
        """获取远程文件内容，用于预览。

        仅读取文本内容，大文件会被截断到 max_size 字节。
        使用 errors='replace' 容错解码，适合预览二进制文件避免崩溃。

        Args:
            connection_id: 连接唯一标识符
            remote_path: 远程文件路径
            max_size: 最大读取字节数，默认1MB

        Returns:
            文件内容字符串

        Raises:
            KeyError: 连接ID不存在
            IOError: 远程文件不存在或读取失败
            paramiko.SFTPError: SFTP操作失败
        """
        logger.info("读取文件内容 [%s]: %s", connection_id, remote_path)

        sftp = self._ssh_manager.get_sftp_client(connection_id)
        try:
            # 先检查文件大小，超大文件给出警告
            stat = sftp.stat(remote_path)
            if stat.st_size and stat.st_size > max_size:
                logger.warning(
                    "文件较大，将被截断 [%s]: %s (%d字节 > %d字节限制)",
                    connection_id,
                    remote_path,
                    stat.st_size,
                    max_size,
                )

            with sftp.file(remote_path, "r") as remote_file:
                content = remote_file.read(max_size)
                text = content.decode("utf-8", errors="replace")

            logger.info(
                "读取文件内容完成 [%s]: %s (%d字符)",
                connection_id,
                remote_path,
                len(text),
            )
            self.operation_completed.emit(connection_id, "read", remote_path)
            return text
        except OSError as e:
            logger.error("读取文件内容失败 [%s]: %s - %s", connection_id, remote_path, e)
            raise OSError(f"读取文件失败 '{remote_path}': {e}") from e
        finally:
            sftp.close()

    @staticmethod
    def _mode_to_permissions(mode: int) -> str:
        """将st_mode转换为rwx权限字符串。

        Args:
            mode: stat.st_mode 值

        Returns:
            10字符权限字符串，如 'drwxr-xr-x'
        """
        # 文件类型字符
        file_type = "?"
        type_bits = mode & 0o170000
        if type_bits == 0o040000:
            file_type = "d"
        elif type_bits == 0o120000:
            file_type = "l"
        elif type_bits == 0o100000:
            file_type = "-"

        # 权限位：user、group、other 各3位
        perms = ""
        for shift in (6, 3, 0):
            bits = (mode >> shift) & 0o7
            perms += "r" if bits & 4 else "-"
            perms += "w" if bits & 2 else "-"
            perms += "x" if bits & 1 else "-"

        return file_type + perms
