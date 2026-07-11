"""系统监控数据解析函数测试。"""
from __future__ import annotations

import pytest

from tdsf_desktop.ssh.monitor import (
    SystemMetrics,
    SystemInfo,
    calculate_cpu_usage,
    calculate_network_speed,
    parse_cpu_data,
    parse_disk_data,
    parse_memory_data,
    parse_network_data,
    parse_size_value,
)


class TestParseSizeValue:
    """parse_size_value 函数测试。"""

    @pytest.mark.parametrize(
        "input_str,expected",
        [
            ("1024", 1024.0),
            ("550M", 550.0),
            ("4.9G", 5017.6),
            ("1024K", 1.0),
            ("1T", 1048576.0),
            ("", 0.0),
            ("invalid", 0.0),
        ],
    )
    def test_parse_size_value(self, input_str: str, expected: float) -> None:
        """测试大小值解析。"""
        result = parse_size_value(input_str)
        assert abs(result - expected) < 0.1


class TestParseCpuData:
    """parse_cpu_data 函数测试。"""

    def test_parse_normal_cpu_data(self) -> None:
        """测试正常 /proc/stat 输出解析。"""
        sample = """cpu  100 200 300 4000 50 10 5 0
cpu0 50 100 150 2000 25 5 2 0
cpu1 50 100 150 2000 25 5 3 0"""
        result = parse_cpu_data(sample)
        assert result["total"] is not None
        assert len(result["total"]) == 8
        assert result["total"][0] == 100  # user
        assert len(result["cores"]) == 2

    def test_parse_empty_output(self) -> None:
        """测试空输出。"""
        result = parse_cpu_data("")
        assert result["total"] is None
        assert result["cores"] == []


class TestCalculateCpuUsage:
    """calculate_cpu_usage 函数测试。"""

    def test_calculate_normal_usage(self) -> None:
        """测试正常 CPU 使用率计算。"""
        prev = {
            "total": [100, 0, 100, 800, 0, 0, 0, 0],
            "cores": [[50, 0, 50, 400, 0, 0, 0, 0]],
        }
        curr = {
            "total": [110, 0, 110, 900, 0, 0, 0, 0],
            "cores": [[55, 0, 55, 450, 0, 0, 0, 0]],
        }
        result = calculate_cpu_usage(prev, curr)
        assert 0.0 <= result["total_usage"] <= 100.0
        assert len(result["cores_usage"]) == 1

    def test_calculate_zero_delta(self) -> None:
        """测试零差值（无变化）。"""
        prev = {
            "total": [100, 0, 100, 800, 0, 0, 0, 0],
            "cores": [],
        }
        curr = {
            "total": [100, 0, 100, 800, 0, 0, 0, 0],
            "cores": [],
        }
        result = calculate_cpu_usage(prev, curr)
        assert result["total_usage"] == 0.0

    def test_calculate_missing_data(self) -> None:
        """测试数据缺失情况。"""
        prev = {"total": None, "cores": []}
        curr = {"total": None, "cores": []}
        result = calculate_cpu_usage(prev, curr)
        assert result["total_usage"] == 0.0


class TestParseMemoryData:
    """parse_memory_data 函数测试。"""

    def test_parse_normal_memory(self) -> None:
        """测试正常 free -m 输出解析。"""
        sample = """               total        used        free      shared  buff/cache   available
Mem:           7980        4900         550         334        2300        2100
Swap:          2048           0        2048"""
        result = parse_memory_data(sample)
        assert result["total"] == 7980
        assert result["used"] == 4900
        assert result["available"] == 2100
        assert 0.0 <= result["usage_percent"] <= 100.0

    def test_parse_empty_output(self) -> None:
        """测试空输出。"""
        result = parse_memory_data("")
        assert result["total"] == 0


class TestParseDiskData:
    """parse_disk_data 函数测试。"""

    def test_parse_normal_disk(self) -> None:
        """测试正常 df -h 输出解析。"""
        sample = """Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1        50G   20G   30G  40% /
tmpfs           2.0G  1.0G  1.0G  50% /tmp"""
        result = parse_disk_data(sample)
        # tmpfs 应被过滤
        assert len(result) == 1
        assert result[0]["filesystem"] == "/dev/sda1"
        assert result[0]["usage_percent"] == 40.0
        assert result[0]["mount_point"] == "/"

    def test_parse_empty_output(self) -> None:
        """测试空输出。"""
        result = parse_disk_data("")
        assert result == []


class TestParseNetworkData:
    """parse_network_data 函数测试。"""

    def test_parse_normal_network(self) -> None:
        """测试正常 /proc/net/dev 输出解析。"""
        sample = """Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo frame compressed multicast
    lo: 123456  789    0   0    0     0          0         0  123456  789    0   0    0     0          0         0
  eth0: 123456  789    0   0    0     0          0         0  654321  456    0   0    0     0          0         0"""
        result = parse_network_data(sample)
        # lo 应被过滤
        assert "lo" not in result
        assert "eth0" in result
        assert result["eth0"]["rx_bytes"] == 123456
        assert result["eth0"]["tx_bytes"] == 654321


class TestCalculateNetworkSpeed:
    """calculate_network_speed 函数测试。"""

    def test_calculate_normal_speed(self) -> None:
        """测试正常网络速率计算。"""
        prev = {"eth0": {"rx_bytes": 1000, "tx_bytes": 500}}
        curr = {"eth0": {"rx_bytes": 2000, "tx_bytes": 800}}
        result = calculate_network_speed(prev, curr, interval=1.0)
        assert len(result["interfaces"]) == 1
        iface = result["interfaces"][0]
        assert iface["name"] == "eth0"
        assert iface["rx_speed"] == 1000.0
        assert iface["tx_speed"] == 300.0

    def test_zero_interval(self) -> None:
        """测试零间隔（应避免除零错误）。"""
        prev = {"eth0": {"rx_bytes": 1000, "tx_bytes": 500}}
        curr = {"eth0": {"rx_bytes": 2000, "tx_bytes": 800}}
        result = calculate_network_speed(prev, curr, interval=0)
        assert len(result["interfaces"]) == 1


class TestDataclasses:
    """数据类测试。"""

    def test_system_info_defaults(self) -> None:
        """测试 SystemInfo 默认值。"""
        info = SystemInfo()
        assert info.hostname == ""
        assert info.cpu_cores == 0
        assert info.load_average == []

    def test_system_metrics_defaults(self) -> None:
        """测试 SystemMetrics 默认值。"""
        metrics = SystemMetrics()
        assert metrics.cpu_usage == 0.0
        assert metrics.mem_total == 0
        assert metrics.disk_partitions == []
