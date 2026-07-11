"""集成测试：Agent 工作流端到端。

测试 AgentWorkflow 的降级分析路径（无需真实 LLM 和 SSH），
验证从日志分析到生成建议的完整逻辑链路。
"""
from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch

import pytest

from tdsf_desktop.core.ai_agent import AgentWorkflow, LLMClient, SuggestionResult
from tdsf_desktop.core.command_safety import CommandSafetyChecker, RiskLevel


class TestRuleBasedAnalysis:
    """基于规则的降级分析测试。"""

    @pytest.fixture
    def workflow(self) -> AgentWorkflow:
        """创建使用不可用 LLM 的 AgentWorkflow（触发降级）。"""
        with patch.object(LLMClient, "_load_api_key", return_value=""):
            llm = LLMClient()
        ssh_mock = MagicMock()
        ssh_mock.execute_command = MagicMock(return_value=(0, "output", ""))
        safety = CommandSafetyChecker()
        return AgentWorkflow(llm, ssh_mock, safety)

    def test_disk_full_analysis(self, workflow: AgentWorkflow) -> None:
        """测试磁盘满场景的降级分析。"""
        suggestion = workflow._rule_based_analysis(
            "磁盘空间不足",
            "No space left on device",
            {"df -h": "Filesystem  Size  Used  Avail  Use%  Mounted on"},
        )
        assert "磁盘" in suggestion.hypothesis
        assert suggestion.command == "df -h"
        assert suggestion.confidence > 0.5

    def test_permission_denied_analysis(self, workflow: AgentWorkflow) -> None:
        """测试权限拒绝场景。"""
        suggestion = workflow._rule_based_analysis(
            "权限问题",
            "permission denied",
            {},
        )
        assert "权限" in suggestion.hypothesis

    def test_oom_analysis(self, workflow: AgentWorkflow) -> None:
        """测试 OOM 场景。"""
        suggestion = workflow._rule_based_analysis(
            "内存不足",
            "Out of memory: Killed process",
            {},
        )
        assert "内存" in suggestion.hypothesis

    def test_connection_refused_analysis(self, workflow: AgentWorkflow) -> None:
        """测试连接拒绝场景。"""
        suggestion = workflow._rule_based_analysis(
            "服务无法访问",
            "connection refused",
            {},
        )
        assert "服务" in suggestion.hypothesis or "端口" in suggestion.hypothesis

    def test_unknown_error_analysis(self, workflow: AgentWorkflow) -> None:
        """测试未知错误场景（兜底）。"""
        suggestion = workflow._rule_based_analysis(
            "未知问题",
            "some random text without keywords",
            {},
        )
        assert suggestion.confidence < 0.5
        assert suggestion.command == ""


class TestLLMSuggestionParsing:
    """LLM 响应解析测试。"""

    @pytest.fixture
    def workflow(self) -> AgentWorkflow:
        """创建 AgentWorkflow。"""
        with patch.object(LLMClient, "_load_api_key", return_value=""):
            llm = LLMClient()
        ssh_mock = MagicMock()
        safety = CommandSafetyChecker()
        return AgentWorkflow(llm, ssh_mock, safety)

    def test_parse_json_code_block(self, workflow: AgentWorkflow) -> None:
        """测试从 JSON 代码块解析。"""
        llm_response = (
            '```json\n'
            '{"hypothesis": "磁盘空间不足", '
            '"command": "df -h", '
            '"risk_assessment": "SAFE", '
            '"explanation": "检查磁盘使用情况"}\n'
            '```'
        )
        result = workflow._parse_llm_suggestion(llm_response)
        assert result.hypothesis == "磁盘空间不足"
        assert result.command == "df -h"

    def test_parse_direct_json(self, workflow: AgentWorkflow) -> None:
        """测试直接 JSON 解析。"""
        llm_response = (
            '{"hypothesis": "内存不足", '
            '"command": "free -m", '
            '"risk_assessment": "SAFE", '
            '"explanation": "检查内存"}'
        )
        result = workflow._parse_llm_suggestion(llm_response)
        assert result.hypothesis == "内存不足"
        assert result.command == "free -m"

    def test_parse_bash_fallback(self, workflow: AgentWorkflow) -> None:
        """测试从 bash 代码块降级解析。"""
        llm_response = (
            "根据分析，建议执行以下命令：\n"
            "```bash\n"
            "ps aux --sort=-%cpu | head -10\n"
            "```"
        )
        result = workflow._parse_llm_suggestion(llm_response)
        assert result.command == "ps aux --sort=-%cpu | head -10"

    def test_parse_no_command(self, workflow: AgentWorkflow) -> None:
        """测试无命令的纯文本响应。"""
        llm_response = "这是一个复杂问题，需要人工分析。"
        result = workflow._parse_llm_suggestion(llm_response)
        assert result.command == ""
        assert result.confidence == 0.3


class TestConfidenceComputation:
    """置信度计算测试。"""

    @pytest.fixture
    def workflow(self) -> AgentWorkflow:
        """创建 AgentWorkflow。"""
        with patch.object(LLMClient, "_load_api_key", return_value=""):
            llm = LLMClient()
        ssh_mock = MagicMock()
        safety = CommandSafetyChecker()
        return AgentWorkflow(llm, ssh_mock, safety)

    def test_empty_hypothesis(self, workflow: AgentWorkflow) -> None:
        """测试空假设的置信度。"""
        confidence = workflow._compute_confidence("", {})
        assert confidence == 0.0

    def test_with_supporting_evidence(self, workflow: AgentWorkflow) -> None:
        """测试有证据支持的假设。"""
        env_info = {
            "free -m": "total used free shared cache available",
            "df -h": "Filesystem Size Used Avail Use% Mounted on",
        }
        confidence = workflow._compute_confidence("磁盘空间不足", env_info)
        assert 0.5 <= confidence <= 0.95

    def test_without_supporting_evidence(self, workflow: AgentWorkflow) -> None:
        """测试无证据支持的假设。"""
        env_info = {"hostname": "server-01"}
        confidence = workflow._compute_confidence("网络配置错误", env_info)
        assert confidence >= 0.5  # 基础置信度


class TestSafetyCheckIntegration:
    """安全检查与 Agent 集成测试。"""

    def test_safe_command_passes_safety_check(self) -> None:
        """SAFE 命令通过安全检查。"""
        checker = CommandSafetyChecker()
        result = checker.check("df -h")
        assert result.risk_level == RiskLevel.SAFE
        assert result.is_allowed is True

    def test_critical_command_blocked(self) -> None:
        """CRITICAL 命令被阻止。"""
        checker = CommandSafetyChecker()
        result = checker.check("rm -rf /")
        assert result.risk_level == RiskLevel.CRITICAL
        assert result.is_allowed is False

    def test_medium_command_needs_confirmation(self) -> None:
        """MEDIUM 命令需要确认但允许执行。"""
        checker = CommandSafetyChecker()
        result = checker.check("systemctl restart nginx")
        assert result.risk_level == RiskLevel.MEDIUM
        assert result.is_allowed is True
