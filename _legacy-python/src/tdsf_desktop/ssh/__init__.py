"""SSH与SFTP管理模块。

提供基于paramiko的SSH连接管理和SFTP文件操作功能。
"""

from .connection import AuthMethod, ServerConfig, SSHConnectionManager
from .sftp import RemoteFile, SFTPManager

__all__ = [
    "AuthMethod",
    "RemoteFile",
    "ServerConfig",
    "SFTPManager",
    "SSHConnectionManager",
]
