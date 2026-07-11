"""安全检查器快速验证脚本。"""
from __future__ import annotations

import sys
from pathlib import Path

# 确保 src 目录在路径中
sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from tdsf_desktop.core.command_safety import CommandSafetyChecker

checker = CommandSafetyChecker()

# 测试 CRITICAL
tests_critical = [
    "rm -rf /",
    "rm -rf /*",
    "dd if=/dev/zero of=/dev/sda",
    "mkfs.ext4 /dev/sda1",
    ":(){ :|:& };:",
    "chmod 777 /",
    "chown -R user:user /",
    "echo x > /dev/sda",
]
print("=== CRITICAL 测试 ===")
for cmd in tests_critical:
    r = checker.check(cmd)
    print(f"{cmd:40s} -> {r.risk_level.value:10s} allowed={r.is_allowed} | {r.reason}")

# 测试 HIGH
tests_high = [
    "shutdown -h now",
    "reboot",
    "iptables -F",
    "ufw deny 80",
    "ifconfig eth0 down",
    "ip link set eth0 down",
    "ip addr add 192.168.1.1/24 dev eth0",
]
print()
print("=== HIGH 测试 ===")
for cmd in tests_high:
    r = checker.check(cmd)
    print(f"{cmd:40s} -> {r.risk_level.value:10s} allowed={r.is_allowed} | {r.reason}")

# 测试 SAFE
tests_safe = [
    "ls -la",
    "cat /etc/hosts",
    "df -h",
    "free -m",
    "ps aux",
    "systemctl status nginx",
    "journalctl -u sshd",
    "ping -c 3 8.8.8.8",
]
print()
print("=== SAFE 测试 ===")
for cmd in tests_safe:
    r = checker.check(cmd)
    print(f"{cmd:40s} -> {r.risk_level.value:10s} allowed={r.is_allowed} | {r.reason}")

# 测试 MEDIUM
tests_medium = [
    "sudo ls /root",
    "echo hello > /tmp/test.txt",
    "sed -i 's/old/new/g' file.txt",
    "systemctl restart nginx",
    "apt install htop",
    "yum install nginx",
]
print()
print("=== MEDIUM 测试 ===")
for cmd in tests_medium:
    r = checker.check(cmd)
    print(f"{cmd:40s} -> {r.risk_level.value:10s} allowed={r.is_allowed} | {r.reason}")

print()
print("=== 全部测试完成 ===")
