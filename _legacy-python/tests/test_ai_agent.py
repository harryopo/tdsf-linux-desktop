"""AI Agent 工作流测试。"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tdsf_desktop.core.ai_agent import (
    AgentStep,
    AgentWorkflow,
    LLMClient,
    SuggestionResult,
)
from tdsf_desktop.core.command_safety import CommandSafetyChecker, RiskLevel


class TestAgentStep:
    """AgentStep 数据模型测试。"""

    def test_agent_step_creation(self) -> None:
        """测试 AgentStep 创建。"""
        step = AgentStep(
            step_id="test_1",
            step_name="测试步骤",
            step_type="collect_env",
            status="pending",
            input_data="输入",
            output_data="输出",
            timestamp="2026-07-11T00:00:00Z",
            duration_ms=100,
        )
        assert step.step_id == "test_1"
        assert step.step_name == "测试步骤"
        assert step.status == "pending"


class TestSuggestionResult:
    """SuggestionResult 数据模型测试。"""

    def test_suggestion_result_defaults(self) -> None:
        """测试 SuggestionResult 默认值。"""
        result = SuggestionResult()
        assert result.hypothesis == ""
        assert result.command == ""
        assert result.confidence == 0.0

    def test_suggestion_result_with_values(self) -> None:
        """测试 SuggestionResult 带值创建。"""
        result = SuggestionResult(
            hypothesis="磁盘空间不足",
            command="df -h",
            risk_assessment="SAFE",
            explanation="查看磁盘使用情况",
            confidence=0.85,
        )
        assert result.hypothesis == "磁盘空间不足"
        assert result.confidence == 0.85


class TestLLMClient:
    """LLMClient 测试。"""

    def test_llm_client_unavailable_without_key(self) -> None:
        """测试无 API Key 时 LLM 不可用。"""
        with patch.object(LLMClient, "_load_api_key", return_value=""):
            client = LLMClient()
            assert client.available is False

    def test_llm_client_available_with_key(self) -> None:
        """测试有 API Key 时 LLM 可用。"""
        with patch.object(LLMClient, "_load_api_key", return_value="test-key"):
            client = LLMClient()
            assert client.available is True

    @pytest.mark.asyncio
    async def test_llm_client_chat_without_key_raises(self) -> None:
        """测试无 API Key 时调用 chat 抛异常。"""
        with patch.object(LLMClient, "_load_api_key", return_value=""):
            client = LLMClient()
            with pytest.raises(RuntimeError, match="LLM 不可用"):
                await client.chat("system", "user")


class TestAgentWorkflow:
    """AgentWorkflow 测试。"""

    @pytest.fixture
    def mock_llm(self) -> MagicMock:
        """模拟 LLM 客户端。"""
        llm = MagicMock()
        llm.available = True
        llm.chat = AsyncMock(return_value="分析结果")
        return llm

    @pytest.fixture
    def mock_ssh(self) -> MagicMock:
        """模拟 SSH 管理器。"""
        ssh = MagicMock()
        ssh.execute_command = MagicMock(return_value=(0, "output", ""))
        return ssh

    @pytest.fixture
    def safety_checker(self) -> CommandSafetyChecker:
        """创建安全检查器。"""
        return CommandSafetyChecker()

    def test_workflow_initialization(
        self,
        mock_llm: MagicMock,
        mock_ssh: MagicMock,
        safety_checker: CommandSafetyChecker,
    ) -> None:
        """测试工作流初始化。"""
        workflow = AgentWorkflow(mock_llm, mock_ssh, safety_checker)
        assert workflow._llm is mock_llm
        assert workflow._ssh is mock_ssh
        assert workflow._safety is safety_checker
        assert workflow.get_steps() == []

    def test_approve_execution_without_event(
        self,
        mock_llm: MagicMock,
        mock_ssh: MagicMock,
        safety_checker: CommandSafetyChecker,
    ) -> None:
        """测试在无确认事件时批准执行（不应崩溃）。"""
        workflow = AgentWorkflow(mock_llm, mock_ssh, safety_checker)
        # 未启动工作流时调用 approve_execution 不应抛出异常
        workflow.approve_execution()
        assert workflow._confirmation_approved is True

    def test_reject_execution_without_event(
        self,
        mock_llm: MagicMock,
        mock_ssh: MagicMock,
        safety_checker: CommandSafetyChecker,
    ) -> None:
        """测试在无确认事件时拒绝执行（不应崩溃）。"""
        workflow = AgentWorkflow(mock_llm, mock_ssh, safety_checker)
        workflow.reject_execution()
        assert workflow._confirmation_approved is False
