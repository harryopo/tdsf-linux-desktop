"""系统信息采集模块。

通过SSH连接远程Linux服务器，定时采集系统信息（CPU、内存、磁盘、网络等）。
基于QThread实现后台执行，通过信号将采集结果发送到主线程，不阻塞UI。

借鉴cube-shell项目的解析算法（parse_data.py），适配本项目的SSHConnectionManager接口。
"""

from __future__ import annotations

import logging
import re
import time
from collections import deque
from dataclasses import dataclass, field

from PySide6.QtCore import QThread, Signal

from tdsf_desktop.ssh.connection import SSHConnectionManager

logger = logging.getLogger(__name__)


# ============================================================================
# 数据结构
# ============================================================================
@dataclass
class SystemInfo:
    """系统静态信息（一次性采集）。

    Attributes:
        hostname: 主机名
        os: 操作系统发行版，如 "Ubuntu 22.04 LTS"
        kernel: 内核版本，如 "5.15.0-91-generic"
        arch: 系统架构，如 "x86_64"
        uptime: 运行时长可读字符串，如 "3天 5小时 20分钟"
        cpu_model: CPU型号，如 "Intel Core i7-10700K"
        cpu_cores: CPU核心数
        load_average: 负载平均值 [1min, 5min, 15min]
    """

    hostname: str = ""
    os: str = ""
    kernel: str = ""
    arch: str = ""
    uptime: str = ""
    cpu_model: str = ""
    cpu_cores: int = 0
    load_average: list[float] = field(default_factory=list)


@dataclass
class SystemMetrics:
    """系统实时指标（定时采集）。

    Attributes:
        cpu_usage: 总CPU使用率（百分比）
        cpu_usage_per_core: 每个核心的使用率（百分比列表）
        mem_total: 内存总量（MB）
        mem_used: 已用内存（MB）
        mem_available: 可用内存（MB）
        mem_usage_percent: 内存使用率（百分比）
        disk_partitions: 磁盘分区列表
        network_interfaces: 网络接口列表
    """

    cpu_usage: float = 0.0
    cpu_usage_per_core: list[float] = field(default_factory=list)
    mem_total: int = 0
    mem_used: int = 0
    mem_available: int = 0
    mem_usage_percent: float = 0.0
    disk_partitions: list[dict] = field(default_factory=list)
    network_interfaces: list[dict] = field(default_factory=list)


# ============================================================================
# 数据解析函数（借鉴cube-shell的parse_data.py）
# ============================================================================
def parse_size_value(size_str: str) -> float:
    """解析带单位的大小值为MB。

    支持形如 "4.9G"、"550M"、"1024K" 等格式，返回统一以MB为单位的浮点数。
    去除可能存在的ANSI颜色代码。

    Args:
        size_str: 带单位的大小字符串，如 "4.9G"

    Returns:
        以MB为单位的浮点数值；无法解析时返回0.0
    """
    clean_str = re.sub(r"\x1b\[[0-9;]*m", "", size_str).strip()

    # 尝试直接解析为浮点数（无单位时，free -m 输出即为MB）
    try:
        return float(clean_str)
    except ValueError:
        pass

    # 带单位的解析
    match = re.match(r"^([\d.]+)([KMGTP])?i?[Bb]?$", clean_str, re.IGNORECASE)
    if match:
        value_str, unit = match.groups()
        value = float(value_str)

        if unit:
            unit_upper = unit.upper()
            if unit_upper == "K":
                value /= 1024
            elif unit_upper == "G":
                value *= 1024
            elif unit_upper == "T":
                value *= 1024 * 1024
            elif unit_upper == "P":
                value *= 1024 * 1024 * 1024
            # M 保持不变

        return value

    return 0.0


def parse_cpu_data(output: str) -> dict:
    """解析 /proc/stat 输出，提取CPU时间片数据。

    /proc/stat 格式：
        cpu  user nice system idle iowait irq softirq steal guest guest_nice
        cpu0  ...

    Args:
        output: /proc/stat 命令输出文本

    Returns:
        包含CPU数据的字典：
            - 'total': 总CPU时间片列表（8个值），无数据时为None
            - 'cores': 各核心时间片列表（每个元素为8个值的列表）
    """
    result: dict = {"total": None, "cores": []}

    lines = output.strip().split("\n")
    for line in lines:
        parts = line.split()
        if not parts:
            continue

        if parts[0] == "cpu":
            # 总CPU行：user, nice, system, idle, iowait, irq, softirq, steal
            result["total"] = [int(x) for x in parts[1:9]]
        elif parts[0].startswith("cpu") and parts[0][3:].isdigit():
            # 单个核心行
            result["cores"].append([int(x) for x in parts[1:9]])

    return result


def calculate_cpu_usage(prev_data: dict, curr_data: dict) -> dict:
    """根据两次CPU快照计算使用率。

    使用两次采样的时间片差值计算CPU使用率，避免累计值导致的误差。

    Args:
        prev_data: 第一次CPU数据（parse_cpu_data返回值）
        curr_data: 第二次CPU数据（parse_cpu_data返回值）

    Returns:
        CPU使用率数据字典：
            - 'total_usage': 总CPU使用率（百分比）
            - 'user_usage': 用户态使用率（百分比）
            - 'system_usage': 内核态使用率（百分比）
            - 'iowait': IO等待占比（百分比）
            - 'cores_usage': 各核心使用率列表（百分比）
    """

    def _calc(prev: list[int], curr: list[int]) -> tuple[float, float, float, float]:
        """计算单组CPU时间片的使用率。

        Args:
            prev: 前一次时间片
            curr: 当前时间片

        Returns:
            (total_usage, user_usage, system_usage, iowait) 四元组
        """
        prev_total = sum(prev)
        curr_total = sum(curr)
        delta_total = curr_total - prev_total

        if delta_total == 0:
            return 0.0, 0.0, 0.0, 0.0

        # idle是第4个值（索引3），iowait是第5个值（索引4）
        delta_idle = curr[3] - prev[3]
        delta_iowait = curr[4] - prev[4]
        # user + nice
        delta_user = (curr[0] + curr[1]) - (prev[0] + prev[1])
        # system
        delta_system = curr[2] - prev[2]

        total_usage = 100.0 * (1.0 - float(delta_idle) / float(delta_total))
        user_usage = 100.0 * float(delta_user) / float(delta_total)
        system_usage = 100.0 * float(delta_system) / float(delta_total)
        iowait_usage = 100.0 * float(delta_iowait) / float(delta_total)

        return total_usage, user_usage, system_usage, iowait_usage

    # 数据缺失时返回零值
    if prev_data["total"] is None or curr_data["total"] is None:
        return {
            "total_usage": 0.0,
            "user_usage": 0.0,
            "system_usage": 0.0,
            "iowait": 0.0,
            "cores_usage": [],
        }

    total_usage, user_usage, system_usage, iowait = _calc(prev_data["total"], curr_data["total"])

    # 计算每个核心的使用率
    cores_usage: list[float] = []
    core_count = min(len(prev_data["cores"]), len(curr_data["cores"]))
    for i in range(core_count):
        core_usage, _, _, _ = _calc(prev_data["cores"][i], curr_data["cores"][i])
        cores_usage.append(core_usage)

    return {
        "total_usage": total_usage,
        "user_usage": user_usage,
        "system_usage": system_usage,
        "iowait": iowait,
        "cores_usage": cores_usage,
    }


def parse_memory_data(output: str) -> dict:
    """解析 free -m 命令输出，提取内存使用信息。

    free -m 输出格式：
                 total        used        free      shared  buff/cache   available
        Mem:           7980        4900         550         334        2300        2100
        Swap:          2048           0        2048

    Args:
        output: free -m 命令输出文本

    Returns:
        内存信息字典（单位MB）：
            - 'total': 总内存
            - 'used': 已用内存
            - 'free': 空闲内存
            - 'shared': 共享内存
            - 'cache': 缓存
            - 'available': 可用内存
            - 'usage_percent': 使用率（百分比，基于available计算）
    """
    memory_stats: dict = {
        "total": 0,
        "used": 0,
        "free": 0,
        "shared": 0,
        "cache": 0,
        "available": 0,
        "usage_percent": 0.0,
    }

    lines = output.strip().split("\n")
    if len(lines) < 2:
        return memory_stats

    # 查找以 "Mem:" 开头的行
    mem_line = None
    for line in lines:
        if line.strip().startswith("Mem:"):
            mem_line = line.strip()
            break

    if mem_line is None:
        return memory_stats

    mem_parts = re.split(r"\s+", mem_line)
    if len(mem_parts) < 7:
        return memory_stats

    try:
        total = parse_size_value(mem_parts[1])
        used = parse_size_value(mem_parts[2])
        free = parse_size_value(mem_parts[3])
        shared = parse_size_value(mem_parts[4])
        cache = parse_size_value(mem_parts[5])
        available = parse_size_value(mem_parts[6])

        # 使用率基于available计算（不含缓存），更贴近实际使用情况
        usage_percent = ((total - available) / total * 100) if total > 0 else 0.0

        memory_stats = {
            "total": total,
            "used": used,
            "free": free,
            "shared": shared,
            "cache": cache,
            "available": available,
            "usage_percent": usage_percent,
        }
    except (ValueError, IndexError) as e:
        logger.error("解析内存数据失败: %s", e)

    return memory_stats


def parse_disk_data(output: str) -> list[dict]:
    """解析 df -h 命令输出，提取磁盘分区使用情况。

    df -h 输出格式：
        Filesystem      Size  Used Avail Use% Mounted on
        /dev/sda1        50G   20G   30G  40% /

    过滤伪文件系统（tmpfs、devtmpfs、overlay、squashfs、loop等）。

    Args:
        output: df -h 命令输出文本

    Returns:
        分区信息字典列表，每个字典包含：
            - 'filesystem': 文件系统设备名
            - 'size': 总大小（原始字符串，如 "50G"）
            - 'used': 已用大小（原始字符串）
            - 'available': 可用大小（原始字符串）
            - 'usage_percent': 使用率（浮点数，不含%号）
            - 'mount_point': 挂载点
    """
    partitions: list[dict] = []
    lines = output.strip().split("\n")
    if len(lines) < 2:
        return partitions

    # 伪文件系统黑名单
    pseudo_fs_prefixes = ("tmpfs", "devtmpfs", "overlay", "squashfs", "none", "udev")
    pseudo_fs_keywords = ("loop",)

    for line in lines[1:]:
        parts = re.split(r"\s+", line.strip())
        if len(parts) < 6:
            continue

        filesystem = parts[0]

        # 过滤伪文件系统
        if filesystem in pseudo_fs_prefixes:
            continue
        if any(kw in filesystem for kw in pseudo_fs_keywords):
            continue

        try:
            usage_percent = float(parts[4].rstrip("%"))
        except ValueError:
            continue

        partition = {
            "filesystem": filesystem,
            "size": parts[1],
            "used": parts[2],
            "available": parts[3],
            "usage_percent": usage_percent,
            "mount_point": parts[5],
        }
        partitions.append(partition)

    return partitions


def parse_network_data(output: str) -> dict:
    """解析 /proc/net/dev 输出，提取各网络接口的收发字节数。

    /proc/net/dev 格式（每行16个字段）：
        Inter-|   Receive                                                |  Transmit
         face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets ...
            lo: 123456  789    0   0    0     0          0         0  123456  789 ...
          eth0: 123456  789    0   0    0     0          0         0  123456  789 ...

    Args:
        output: /proc/net/dev 命令输出文本

    Returns:
        网络接口数据字典，键为接口名，值为包含以下字段的字典：
            - 'rx_bytes': 接收字节数
            - 'rx_packets': 接收包数
            - 'rx_errors': 接收错误数
            - 'rx_dropped': 接收丢包数
            - 'tx_bytes': 发送字节数
            - 'tx_packets': 发送包数
            - 'tx_errors': 发送错误数
            - 'tx_dropped': 发送丢包数
    """
    interfaces: dict = {}
    lines = output.strip().split("\n")

    # 跳过前两行标题行
    for line in lines[2:]:
        if ":" not in line:
            continue

        name, data = line.split(":", 1)
        name = name.strip()

        # 跳过回环接口
        if name == "lo":
            continue

        values = data.split()
        if len(values) < 16:
            continue

        try:
            interfaces[name] = {
                "rx_bytes": int(values[0]),
                "rx_packets": int(values[1]),
                "rx_errors": int(values[2]),
                "rx_dropped": int(values[3]),
                "tx_bytes": int(values[8]),
                "tx_packets": int(values[9]),
                "tx_errors": int(values[10]),
                "tx_dropped": int(values[11]),
            }
        except (ValueError, IndexError) as e:
            logger.warning("解析网络接口 %s 数据失败: %s", name, e)
            continue

    return interfaces


def calculate_network_speed(prev_data: dict, curr_data: dict, interval: float) -> dict:
    """根据两次网络快照计算网络速率。

    Args:
        prev_data: 第一次网络数据（parse_network_data返回值）
        curr_data: 第二次网络数据（parse_network_data返回值）
        interval: 两次采样的时间间隔（秒）

    Returns:
        网络速率数据字典：
            - 'interfaces': 接口速率列表，每个元素包含：
                - 'name': 接口名
                - 'rx_speed': 接收速率（字节/秒）
                - 'tx_speed': 发送速率（字节/秒）
                - 'rx_bytes': 当前接收总字节
                - 'tx_bytes': 当前发送总字节
    """
    # 防止除零错误
    if interval <= 0:
        interval = 0.1

    interface_stats: list[dict] = []
    for name, curr in curr_data.items():
        if name not in prev_data:
            continue

        prev = prev_data[name]
        rx_bytes_delta = curr["rx_bytes"] - prev["rx_bytes"]
        tx_bytes_delta = curr["tx_bytes"] - prev["tx_bytes"]

        rx_speed = rx_bytes_delta / interval
        tx_speed = tx_bytes_delta / interval

        interface_stats.append(
            {
                "name": name,
                "rx_speed": rx_speed,
                "tx_speed": tx_speed,
                "rx_bytes": curr["rx_bytes"],
                "tx_bytes": curr["tx_bytes"],
            }
        )

    return {"interfaces": interface_stats}


def parse_load_average(output: str) -> list[float]:
    """解析负载平均值。

    支持解析 uptime 或 cat /proc/loadavg 的输出。

    uptime 格式：... load average: 0.52, 0.58, 0.59
    /proc/loadavg 格式：0.52 0.58 0.59 1/234 5678

    Args:
        output: 命令输出文本

    Returns:
        负载平均值列表 [1min, 5min, 15min]，解析失败返回 [0.0, 0.0, 0.0]
    """
    # 先尝试 uptime 格式
    match = re.search(r"load average:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)", output)
    if match:
        try:
            return [float(match.group(1)), float(match.group(2)), float(match.group(3))]
        except ValueError:
            pass

    # 尝试 /proc/loadavg 格式
    parts = output.strip().split()
    if len(parts) >= 3:
        try:
            return [float(parts[0]), float(parts[1]), float(parts[2])]
        except ValueError:
            pass

    return [0.0, 0.0, 0.0]


def _format_uptime(seconds: float) -> str:
    """将运行时长（秒）格式化为可读字符串。

    Args:
        seconds: 运行时长（秒）

    Returns:
        格式化字符串，如 "3天 5小时 20分钟"、"5小时 20分钟"、"20分钟"
    """
    if seconds <= 0:
        return "未知"

    days = int(seconds // 86400)
    hours = int((seconds % 86400) // 3600)
    mins = int((seconds % 3600) // 60)

    if days > 0:
        return f"{days}天 {hours}小时 {mins}分钟"
    if hours > 0:
        return f"{hours}小时 {mins}分钟"
    return f"{mins}分钟"


def parse_system_info(
    hostname_out: str,
    uname_out: str,
    os_release_out: str,
    uptime_out: str,
    cpuinfo_out: str,
    loadavg_out: str,
) -> SystemInfo:
    """解析系统静态信息。

    综合多个命令的输出，提取系统信息。

    Args:
        hostname_out: hostname 命令输出
        uname_out: uname -a 命令输出
        os_release_out: cat /etc/os-release 命令输出
        uptime_out: cat /proc/uptime 命令输出
        cpuinfo_out: cat /proc/cpuinfo 命令输出
        loadavg_out: cat /proc/loadavg 命令输出

    Returns:
        SystemInfo: 系统静态信息对象
    """
    info = SystemInfo()

    # 主机名
    info.hostname = hostname_out.strip()

    # uname -a 解析内核版本和架构
    # 格式: Linux hostname 5.15.0-91-generic #101-Ubuntu SMP x86_64 GNU/Linux
    uname_parts = uname_out.strip().split()
    if len(uname_parts) >= 3:
        info.kernel = uname_parts[2]
    if len(uname_parts) >= 12:
        # 最后一个字段通常是架构
        info.arch = uname_parts[-1]
    elif len(uname_parts) >= 4:
        # 某些系统架构可能在倒数第二位
        for part in uname_parts:
            if part in ("x86_64", "aarch64", "armv7l", "i386", "i686", "ppc64le", "s390x"):
                info.arch = part
                break

    # /etc/os-release 解析发行版信息
    os_name = ""
    os_version = ""
    for line in os_release_out.split("\n"):
        if line.startswith("PRETTY_NAME="):
            os_name = line.split("=", 1)[1].strip().strip('"')
            break
        if line.startswith("NAME="):
            os_name = os_name or line.split("=", 1)[1].strip().strip('"')
        if line.startswith("VERSION="):
            os_version = line.split("=", 1)[1].strip().strip('"')

    if os_name:
        info.os = os_name
    elif os_version:
        info.os = os_version

    # /proc/uptime 解析运行时长（秒）
    try:
        uptime_seconds = float(uptime_out.strip().split()[0])
        info.uptime = _format_uptime(uptime_seconds)
    except (ValueError, IndexError):
        info.uptime = "未知"

    # /proc/cpuinfo 解析CPU型号和核心数
    cpu_model = ""
    core_count = 0
    for line in cpuinfo_out.split("\n"):
        line = line.strip()
        if line.startswith("model name") and ":" in line:
            cpu_model = line.split(":", 1)[1].strip()
        elif line.startswith("processor") and ":" in line:
            core_count += 1

    info.cpu_model = cpu_model
    info.cpu_cores = core_count

    # 负载平均值
    info.load_average = parse_load_average(loadavg_out)

    return info


# ============================================================================
# SystemMonitor QThread 类
# ============================================================================
class SystemMonitor(QThread):
    """后台线程：定时通过SSH采集服务器系统信息。

    通过SSHConnectionManager执行远程命令，采集CPU、内存、磁盘、网络等系统指标。
    使用QThread后台执行，通过信号将结果发送到主线程，不阻塞UI。
    使用deque(maxlen=5)对采集数据进行移动平均平滑处理。

    Signals:
        system_info_collected: 系统静态信息采集完成时发射（一次性）
        metrics_updated: 实时指标更新时发射（定时）
        monitoring_error: 采集过程中发生错误时发射
        monitoring_started: 监控开始时发射
        monitoring_stopped: 监控停止时发射
    """

    # 信号定义
    system_info_collected = Signal(dict)
    metrics_updated = Signal(dict)
    monitoring_error = Signal(str)
    monitoring_started = Signal()
    monitoring_stopped = Signal()

    def __init__(
        self,
        ssh_manager: SSHConnectionManager,
        conn_id: str,
        interval: float = 3.0,
        parent=None,
    ) -> None:
        """初始化系统监控线程。

        Args:
            ssh_manager: SSH连接管理器实例
            conn_id: SSH连接ID
            interval: 采集间隔（秒），默认3秒
            parent: 父QObject对象
        """
        super().__init__(parent)
        self._ssh_manager = ssh_manager
        self._conn_id = conn_id
        self._interval = max(1.0, interval)
        self._running = True

        # 数据平滑用的历史队列（移动平均，最多5个采样点）
        # 键按需动态创建，如 'cpu'、'mem'、'net_rx_eth0'、'net_tx_eth0'
        self._smooth_history: dict[str, deque] = {}

        # 上一次CPU和网络快照（用于计算差值）
        self._prev_cpu_data: dict | None = None
        self._prev_net_data: dict | None = None
        self._prev_timestamp: float = 0.0

        logger.info("SystemMonitor已初始化: conn_id=%s, interval=%.1fs", conn_id, self._interval)

    def run(self) -> None:
        """线程主循环：先采集系统信息，然后定时采集实时指标。

        执行流程：
            1. 发射 monitoring_started 信号
            2. 采集一次性系统信息（hostname/uname/os-release/uptime/cpuinfo/loadavg）
            3. 循环采集实时指标（CPU/内存/磁盘/网络）
            4. 每轮采集后等待 interval 秒
            5. 接收到停止请求后退出循环，发射 monitoring_stopped 信号
        """
        self.monitoring_started.emit()
        logger.info("系统监控开始: conn_id=%s", self._conn_id)

        try:
            # 1. 采集一次性系统信息
            self._collect_system_info()
        except Exception as e:
            logger.error("采集系统信息失败: %s", e)
            self.monitoring_error.emit(f"采集系统信息失败: {e}")

        # 2. 循环采集实时指标
        while self._running:
            try:
                self._collect_metrics()
            except Exception as e:
                logger.error("采集实时指标失败: %s", e)
                self.monitoring_error.emit(f"采集实时指标失败: {e}")

            # 等待下一次采集
            self._sleep(self._interval)

        logger.info("系统监控已停止: conn_id=%s", self._conn_id)
        self.monitoring_stopped.emit()

    def stop(self) -> None:
        """请求停止监控。

        设置运行标志为False，主循环将在当前轮次结束后退出。
        此方法不会阻塞，立即返回。
        """
        self._running = False
        logger.info("已请求停止系统监控: conn_id=%s", self._conn_id)

    # ------------------------------------------------------------------------
    # 内部方法
    # ------------------------------------------------------------------------
    def _collect_system_info(self) -> None:
        """采集一次性系统静态信息。

        执行多个命令获取系统信息，解析后通过 system_info_collected 信号发送。
        单个命令失败不影响其他命令的采集。
        """
        hostname_out = self._safe_exec("hostname")
        uname_out = self._safe_exec("uname -a")
        os_release_out = self._safe_exec("cat /etc/os-release")
        uptime_out = self._safe_exec("cat /proc/uptime")
        cpuinfo_out = self._safe_exec("cat /proc/cpuinfo")
        loadavg_out = self._safe_exec("cat /proc/loadavg")

        info = parse_system_info(
            hostname_out, uname_out, os_release_out, uptime_out, cpuinfo_out, loadavg_out
        )

        # 转换为字典发送
        info_dict: dict = {
            "hostname": info.hostname,
            "os": info.os,
            "kernel": info.kernel,
            "arch": info.arch,
            "uptime": info.uptime,
            "cpu_model": info.cpu_model,
            "cpu_cores": info.cpu_cores,
            "load_average": info.load_average,
        }

        logger.info(
            "系统信息采集完成: hostname=%s, os=%s, cores=%d",
            info.hostname,
            info.os,
            info.cpu_cores,
        )
        self.system_info_collected.emit(info_dict)

    def _collect_metrics(self) -> None:
        """采集实时指标。

        采集CPU、内存、磁盘、网络指标，计算差值速率，平滑数据后通过
        metrics_updated 信号发送。

        CPU和网络需要两次采样计算差值，第一次采样仅记录不发送，
        第二次采样后计算使用率/速率。
        """
        curr_timestamp = time.time()

        # 采集当前CPU和网络快照
        cpu_output = self._safe_exec("cat /proc/stat")
        net_output = self._safe_exec("cat /proc/net/dev")
        curr_cpu_data = parse_cpu_data(cpu_output)
        curr_net_data = parse_network_data(net_output)

        # 采集内存和磁盘（不需要差值计算）
        mem_output = self._safe_exec("free -m")
        disk_output = self._safe_exec("df -h")
        mem_data = parse_memory_data(mem_output)
        disk_data = parse_disk_data(disk_output)

        # 第一次采样：仅记录，不发送
        if self._prev_cpu_data is None or self._prev_net_data is None:
            self._prev_cpu_data = curr_cpu_data
            self._prev_net_data = curr_net_data
            self._prev_timestamp = curr_timestamp
            logger.debug("首次采样完成，等待下一次采样计算差值")
            return

        # 计算 CPU 使用率
        cpu_usage = calculate_cpu_usage(self._prev_cpu_data, curr_cpu_data)

        # 计算网络速率
        interval = curr_timestamp - self._prev_timestamp
        net_speed = calculate_network_speed(self._prev_net_data, curr_net_data, interval)

        # 数据平滑（移动平均）
        smoothed_cpu = self._smooth("cpu", cpu_usage["total_usage"])
        smoothed_mem = self._smooth("mem", mem_data["usage_percent"])

        # 网络接口速率平滑（按接口名+方向分别维护历史队列）
        smoothed_interfaces: list[dict] = []
        for iface in net_speed["interfaces"]:
            smoothed_rx = self._smooth(f"net_rx_{iface['name']}", iface["rx_speed"])
            smoothed_tx = self._smooth(f"net_tx_{iface['name']}", iface["tx_speed"])
            smoothed_interfaces.append(
                {
                    "name": iface["name"],
                    "rx_speed": smoothed_rx,
                    "tx_speed": smoothed_tx,
                    "rx_bytes": iface["rx_bytes"],
                    "tx_bytes": iface["tx_bytes"],
                }
            )

        # 构建指标字典
        metrics: dict = {
            "cpu_usage": smoothed_cpu,
            "cpu_usage_per_core": cpu_usage["cores_usage"],
            "cpu_user_usage": cpu_usage["user_usage"],
            "cpu_system_usage": cpu_usage["system_usage"],
            "cpu_iowait": cpu_usage["iowait"],
            "mem_total": mem_data["total"],
            "mem_used": mem_data["used"],
            "mem_available": mem_data["available"],
            "mem_usage_percent": smoothed_mem,
            "disk_partitions": disk_data,
            "network_interfaces": smoothed_interfaces,
            "timestamp": curr_timestamp,
        }

        # 更新上一次快照
        self._prev_cpu_data = curr_cpu_data
        self._prev_net_data = curr_net_data
        self._prev_timestamp = curr_timestamp

        logger.debug(
            "指标更新: CPU=%.1f%%, MEM=%.1f%%, 磁盘分区=%d, 网络接口=%d",
            smoothed_cpu,
            smoothed_mem,
            len(disk_data),
            len(smoothed_interfaces),
        )
        self.metrics_updated.emit(metrics)

    def _smooth(self, key: str, value: float) -> float:
        """对数值进行移动平均平滑。

        使用deque(maxlen=5)维护历史窗口，返回窗口内平均值。
        可用于CPU/内存使用率，也可用于网络接口速率（按key区分）。

        Args:
            key: 数据类别键（如 'cpu', 'mem', 'net_rx_eth0'）
            value: 当前采样值

        Returns:
            平滑后的值（历史窗口内的平均值）
        """
        if key not in self._smooth_history:
            self._smooth_history[key] = deque(maxlen=5)
        self._smooth_history[key].append(value)
        history = self._smooth_history[key]
        return sum(history) / len(history) if history else value

    def _safe_exec(self, command: str, timeout: int = 10) -> str:
        """安全执行SSH命令，失败时返回空字符串。

        捕获命令执行过程中的异常（非连接级别），不向上抛出，
        适用于非关键命令的采集。连接级别异常（KeyError/RuntimeError）会向上抛出。

        Args:
            command: 要执行的命令
            timeout: 命令超时时间（秒）

        Returns:
            命令的标准输出文本，失败时返回空字符串
        """
        try:
            exit_code, stdout, stderr = self._ssh_manager.execute_command(
                self._conn_id, command, timeout=timeout
            )
            if exit_code != 0:
                logger.debug("命令返回非零退出码 [%s]: exit_code=%d", command, exit_code)
            return stdout
        except (KeyError, RuntimeError) as e:
            # 连接级别异常，向上抛出由调用方处理
            logger.error("连接异常，停止采集 [%s]: %s", command, e)
            raise
        except Exception as e:
            logger.warning("命令执行失败 [%s]: %s", command, e)
            return ""

    def _sleep(self, seconds: float) -> None:
        """可中断的睡眠。

        将睡眠时间分片（每0.1秒检查一次运行标志），以便及时响应停止请求。

        Args:
            seconds: 睡眠总时长（秒）
        """
        interval = 0.1
        elapsed = 0.0
        while elapsed < seconds and self._running:
            time.sleep(interval)
            elapsed += interval
