"""命令安全检查器测试。"""
from __future__ import annotations

import pytest

from tdsf_desktop.core.command_safety import (
    CommandSafetyChecker,
    RiskLevel,
    SafetyCheckResult,
)


@pytest.fixture
def checker() -> CommandSafetyChecker:
    """创建安全检查器实例。"""
    return CommandSafetyChecker()


class TestCriticalCommands:
    """CRITICAL 级别命令测试。"""

    @pytest.mark.parametrize(
        "command",
        [
            "rm -rf /",
            "rm -rf /*",
            "dd if=/dev/zero of=/dev/sda",
            "mkfs.ext4 /dev/sda1",
            ":(){ :|:& };:",
            "chmod 777 /",
            "chown -R user:user /",
            "echo x > /dev/sda",
        ],
    )
    def test_critical_commands_blocked(
        self, checker: CommandSafetyChecker, command: str
    ) -> None:
        """危险命令应被标记为 CRITICAL 且不允许执行。"""
        result = checker.check(command)
        assert result.risk_level == RiskLevel.CRITICAL
        assert result.is_allowed is False


class TestHighRiskCommands:
    """HIGH 风险命令测试。"""

    @pytest.mark.parametrize(
        "command",
        [
            "shutdown -h now",
            "reboot",
            "iptables -F",
            "ifconfig eth0 down",
            "ip link set eth0 down",
        ],
    )
    def test_high_risk_commands(
        self, checker: CommandSafetyChecker, command: str
    ) -> None:
        """高风险命令应被标记为 HIGH 但允许执行（需人工确认）。"""
        result = checker.check(command)
        assert result.risk_level == RiskLevel.HIGH
        assert result.is_allowed is True


class TestSafeCommands:
    """SAFE 级别命令测试。"""

    @pytest.mark.parametrize(
        "command",
        [
            "ls -la",
            "cat /etc/hosts",
            "df -h",
            "free -m",
            "ps aux",
            "systemctl status nginx",
            "journalctl -u sshd",
        ],
    )
    def test_safe_commands(
        self, checker: CommandSafetyChecker, command: str
    ) -> None:
        """安全命令应被标记为 SAFE 且允许执行。"""
        result = checker.check(command)
        assert result.risk_level == RiskLevel.SAFE
        assert result.is_allowed is True


class TestMediumRiskCommands:
    """MEDIUM 风险命令测试。"""

    @pytest.mark.parametrize(
        "command",
        [
            "sudo ls /root",
            "echo hello > /tmp/test.txt",
            "systemctl restart nginx",
        ],
    )
    def test_medium_risk_commands(
        self, checker: CommandSafetyChecker, command: str
    ) -> None:
        """中等风险命令应被标记为 MEDIUM 且允许执行。"""
        result = checker.check(command)
        assert result.risk_level == RiskLevel.MEDIUM
        assert result.is_allowed is True


class TestSafetyCheckResult:
    """SafetyCheckResult 数据类测试。"""

    def test_default_values(self) -> None:
        """测试默认值。"""
        result = SafetyCheckResult(
            risk_level=RiskLevel.SAFE,
            is_allowed=True,
            reason="test",
        )
        assert result.warnings == []


class TestRiskLevel:
    """RiskLevel 枚举测试。"""

    def test_risk_level_values(self) -> None:
        """测试风险级别枚举值。"""
        assert RiskLevel.SAFE.value == "safe"
        assert RiskLevel.LOW.value == "low"
        assert RiskLevel.MEDIUM.value == "medium"
        assert RiskLevel.HIGH.value == "high"
        assert RiskLevel.CRITICAL.value == "critical"
