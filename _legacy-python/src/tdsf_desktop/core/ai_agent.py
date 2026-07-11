"""AI 运维助手核心模块。

实现人机协同的 Agent 工作流，包括：
    1. 采集服务器环境信息（collect_env）
    2. LLM 分析日志和系统状态（analyze）
    3. 生成修复建议（suggest）
    4. 安全检查器评估命令风险（safety_check）
    5. 人工确认后执行（confirm）
    6. 在 SSH 终端执行确认的命令（execute）
    7. 验证执行结果（verify）

设计要点：
    - 使用 PySide6 信号通知 UI 更新可视化
    - LLM 不可用时降级为基于规则的简单分析
    - SSH 操作通过 asyncio.to_thread 异步包装
    - 人工确认通过 asyncio.Event 实现 HITL 暂停/恢复
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import keyring
from pydantic import BaseModel
from PySide6.QtCore import QObject, Signal

from .command_safety import CommandSafetyChecker, RiskLevel, SafetyCheckResult

logger = logging.getLogger(__name__)


# ──────────────────────────── 配置常量 ────────────────────────────

_KEYRING_SERVICE = "tdsf-desktop"
_KEYRING_API_KEY = "api_key"
_CONFIG_DIR = Path.home() / ".tdsf-desktop"
_CONFIG_FILE = _CONFIG_DIR / "config.json"
_DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
_DEFAULT_MODEL = "doubao-seed-1-6-250615"

# 环境信息采集命令
_ENV_COMMANDS: list[str] = [
    "hostname",
    "uname -a",
    "cat /etc/os-release",
    "free -m",
    "df -h",
    "cat /proc/loadavg",
    "cat /proc/stat",
    "ps aux --sort=-%cpu | head -10",
]

# LLM 系统提示词
_SYSTEM_PROMPT = (
    "你是一个专业的 Linux 运维助手。你的任务是分析服务器日志和系统状态，"
    "诊断问题根因，并给出修复建议。请基于提供的信息进行深入分析。\n\n"
    "要求：\n"
    "1. 给出明确的问题根因假设\n"
    "2. 给出一条可执行的修复命令（只给一条最关键的命令）\n"
    "3. 评估命令的风险等级\n"
    "4. 解释为什么这个命令能解决问题\n"
    "5. 不要生成会调起分页器的命令（避免 less/man），用 cat/head/tail 代替\n"
)


# ──────────────────────────── 数据模型 ────────────────────────────


class AgentStep(BaseModel):
    """Agent 执行步骤。

    Attributes:
        step_id: 步骤唯一标识
        step_name: 步骤名称（如"采集环境信息"、"分析日志"）
        step_type: 步骤类型（collect_env/analyze/suggest/safety_check/confirm/execute/verify）
        status: 状态（pending/running/completed/failed/skipped）
        input_data: 输入描述
        output_data: 输出描述
        timestamp: ISO 格式时间戳
        duration_ms: 执行耗时（毫秒）
    """

    step_id: str
    step_name: str
    step_type: str
    status: str
    input_data: str
    output_data: str
    timestamp: str
    duration_ms: int


class SuggestionResult(BaseModel):
    """LLM 修复建议结果。

    Attributes:
        hypothesis: 问题根因假设
        command: 建议执行的修复命令
        risk_assessment: 命令风险评估
        explanation: 命令解释说明
        confidence: 置信度（0.0-1.0）
    """

    hypothesis: str = ""
    command: str = ""
    risk_assessment: str = ""
    explanation: str = ""
    confidence: float = 0.0


# ──────────────────────────── LLM 客户端 ────────────────────────────


class LLMClient:
    """LLM 客户端。

    读取本地配置（keyring + JSON），通过 OpenAI 兼容 API 调用大模型。
    当 API Key 未配置或调用失败时，标记为不可用，AgentWorkflow 将降级为规则分析。

    鸭子类型接口：
        - ``available`` 属性：返回 LLM 是否可用
        - ``async chat(system_prompt, user_prompt) -> str``：调用 LLM 返回文本
    """

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
    ) -> None:
        """初始化 LLM 客户端。

        Args:
            api_key: API Key，为 None 时从 keyring 读取
            base_url: API 基础地址，为 None 时从配置文件读取
            model: 模型名，为 None 时从配置文件读取
        """
        config = self._load_config()
        self._api_key = api_key or self._load_api_key()
        self._base_url = base_url or config.get("base_url", _DEFAULT_BASE_URL)
        self._model = model or config.get("model", _DEFAULT_MODEL)

    @staticmethod
    def _load_api_key() -> str:
        """从 keyring 读取 API Key。"""
        try:
            return keyring.get_password(_KEYRING_SERVICE, _KEYRING_API_KEY) or ""
        except Exception:
            logger.warning("从 keyring 读取 API Key 失败")
            return ""

    @staticmethod
    def _load_config() -> dict[str, Any]:
        """从 JSON 配置文件读取配置。"""
        if not _CONFIG_FILE.exists():
            return {}
        try:
            return json.loads(_CONFIG_FILE.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            logger.warning("读取配置文件失败: %s", _CONFIG_FILE)
            return {}

    @property
    def available(self) -> bool:
        """LLM 是否可用（API Key 已配置）。"""
        return bool(self._api_key)

    async def chat(self, system_prompt: str, user_prompt: str) -> str:
        """调用 LLM 进行对话。

        Args:
            system_prompt: 系统提示词
            user_prompt: 用户提示词

        Returns:
            LLM 响应文本

        Raises:
            RuntimeError: API Key 未配置
            Exception: LLM 调用失败
        """
        if not self.available:
            raise RuntimeError("LLM 不可用：API Key 未配置")

        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=self._api_key, base_url=self._base_url)
        try:
            response = await client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                max_tokens=2000,
                temperature=0.3,
            )
            return response.choices[0].message.content or ""
        finally:
            await client.close()


# ──────────────────────────── Agent 工作流 ────────────────────────────


class AgentWorkflow(QObject):
    """AI 运维助手工作流。

    人机协同流程：
        1. 采集环境信息（collect_env）- 自动执行 SSH 命令获取系统状态
        2. 分析问题（analyze）- LLM 分析日志 + 环境信息，生成假设
        3. 生成建议（suggest）- LLM 给出修复命令建议
        4. 安全检查（safety_check）- CommandSafetyChecker 评估风险
        5. 人工确认（confirm）- HITL，用户确认是否执行
        6. 执行命令（execute）- 在 SSH 终端执行确认的命令
        7. 验证结果（verify）- 采集执行后的环境信息，对比验证

    Signals:
        step_started: 步骤开始，参数为 step_id
        step_completed: 步骤完成，参数为 (step_id, result_dict)
        step_failed: 步骤失败，参数为 (step_id, error_msg)
        workflow_completed: 工作流完成，参数为 final_result_dict
        confirmation_required: 需要人工确认，参数为 suggestion_dict

    Example:
        >>> workflow = AgentWorkflow(llm_client, ssh_manager, safety_checker)
        >>> workflow.confirmation_required.connect(on_confirm)
        >>> workflow.approve_execution()  # 用户点击"确认执行"
        >>> asyncio.run(workflow.run("磁盘空间不足", log_text, conn_id))
    """

    # ────────── 信号定义 ──────────
    step_started = Signal(str)              # step_id
    step_completed = Signal(str, dict)      # step_id, result
    step_failed = Signal(str, str)          # step_id, error
    workflow_completed = Signal(dict)       # final result
    confirmation_required = Signal(dict)    # suggestion for HITL

    def __init__(
        self,
        llm_client: LLMClient | Any = None,
        ssh_manager: Any = None,
        safety_checker: CommandSafetyChecker | None = None,
        parent: QObject | None = None,
    ) -> None:
        """初始化 Agent 工作流。

        Args:
            llm_client: LLM 客户端，为 None 时创建默认 LLMClient
            ssh_manager: SSH 连接管理器（需有 execute_command 方法）
            safety_checker: 命令安全检查器，为 None 时创建默认实例
            parent: QObject 父对象
        """
        super().__init__(parent)
        self._llm = llm_client or LLMClient()
        self._ssh = ssh_manager
        self._safety = safety_checker or CommandSafetyChecker()
        self._steps: list[AgentStep] = []
        self._confirmation_event: asyncio.Event | None = None
        self._confirmation_approved: bool = False
        self._loop: asyncio.AbstractEventLoop | None = None

    # ────────── 公共接口 ──────────

    async def run(self, user_query: str, log_text: str, conn_id: str) -> None:
        """执行完整工作流。

        Args:
            user_query: 用户问题描述
            log_text: 日志文本内容
            conn_id: SSH 连接 ID
        """
        self._loop = asyncio.get_running_loop()
        self._steps.clear()

        final_result: dict[str, Any] = {
            "user_query": user_query,
            "steps": [],
            "suggestion": None,
            "safety_result": None,
            "execution_result": None,
            "verification": None,
            "success": False,
            "confidence": 0.0,
        }

        try:
            # Step 1: 采集环境信息
            env_info = await self._run_step(
                "collect_env", "采集环境信息", "collect_env",
                f"SSH 连接: {conn_id}",
                self._collect_environment(conn_id),
            )
            if env_info is None:
                env_info = {}

            # Step 2: LLM 分析
            analysis = await self._run_step(
                "analyze", "分析问题", "analyze",
                f"用户问题: {user_query[:100]}, 日志: {len(log_text)} 字符",
                self._analyze_with_llm(user_query, log_text, env_info),
            )
            if analysis is None:
                analysis = {"analysis": "", "env_info": env_info}

            # Step 3: 生成修复建议
            suggestion = await self._run_step(
                "suggest", "生成修复建议", "suggest",
                "基于分析结果生成命令建议",
                self._generate_suggestion(analysis, env_info),
            )

            # 无需执行命令 → 直接完成
            if suggestion is None or not suggestion.command:
                final_result["suggestion"] = (
                    suggestion.model_dump() if suggestion else None
                )
                final_result["success"] = True
                final_result["confidence"] = suggestion.confidence if suggestion else 0.0
                self._finish_workflow(final_result)
                return

            # Step 4: 安全检查
            safety_result = await self._run_step(
                "safety_check", "安全检查", "safety_check",
                f"检查命令: {suggestion.command}",
                self._check_safety(suggestion.command),
            )
            if safety_result is None:
                safety_result = SafetyCheckResult(
                    risk_level=RiskLevel.MEDIUM,
                    is_allowed=True,
                    reason="安全检查失败，默认中等风险",
                )

            final_result["suggestion"] = suggestion.model_dump()
            final_result["safety_result"] = {
                "risk_level": safety_result.risk_level.value,
                "is_allowed": safety_result.is_allowed,
                "reason": safety_result.reason,
                "warnings": safety_result.warnings,
            }

            # CRITICAL 级别 → 直接阻止
            if not safety_result.is_allowed:
                final_result["confidence"] = suggestion.confidence
                self._finish_workflow(final_result)
                return

            # Step 5: 等待人工确认
            approved = await self._run_step(
                "confirm", "人工确认", "confirm",
                "等待用户确认是否执行命令",
                self._wait_for_confirmation(suggestion, safety_result),
            )

            if not approved:
                final_result["confidence"] = suggestion.confidence
                self._finish_workflow(final_result)
                return

            # Step 6: 执行命令
            exec_result = await self._run_step(
                "execute", "执行命令", "execute",
                f"执行: {suggestion.command}",
                self._execute_command(conn_id, suggestion.command),
            )
            if exec_result is None:
                exec_result = {
                    "exit_code": -1, "stdout": "", "stderr": "执行失败", "success": False,
                }

            final_result["execution_result"] = exec_result

            # Step 7: 验证结果
            verification = await self._run_step(
                "verify", "验证结果", "verify",
                "采集执行后环境信息并对比",
                self._verify_result(conn_id, env_info, exec_result, suggestion),
            )

            final_result["verification"] = verification
            final_result["success"] = exec_result.get("success", False)
            final_result["confidence"] = suggestion.confidence
            self._finish_workflow(final_result)

        except Exception as e:
            logger.exception("Agent 工作流执行异常")
            final_result["error"] = str(e)
            self._finish_workflow(final_result)

    def approve_execution(self) -> None:
        """用户批准执行命令。

        在 confirmation_required 信号触发后，UI 调用此方法恢复工作流。
        线程安全：通过 call_soon_threadsafe 设置 Event。
        """
        self._confirmation_approved = True
        if self._confirmation_event is not None and self._loop is not None:
            self._loop.call_soon_threadsafe(self._confirmation_event.set)

    def reject_execution(self) -> None:
        """用户拒绝执行命令。

        在 confirmation_required 信号触发后，UI 调用此方法恢复工作流。
        线程安全：通过 call_soon_threadsafe 设置 Event。
        """
        self._confirmation_approved = False
        if self._confirmation_event is not None and self._loop is not None:
            self._loop.call_soon_threadsafe(self._confirmation_event.set)

    def get_steps(self) -> list[AgentStep]:
        """获取所有步骤记录。

        Returns:
            步骤列表的副本
        """
        return list(self._steps)

    # ────────── 内部：步骤执行框架 ──────────

    async def _run_step(
        self,
        step_id: str,
        step_name: str,
        step_type: str,
        input_desc: str,
        coro: Any,
    ) -> Any:
        """执行一个步骤，发射信号并处理异常。

        Args:
            step_id: 步骤 ID
            step_name: 步骤名称
            step_type: 步骤类型
            input_desc: 输入描述
            coro: 待 await 的协程对象

        Returns:
            步骤结果，失败时返回 None
        """
        step = AgentStep(
            step_id=step_id,
            step_name=step_name,
            step_type=step_type,
            status="running",
            input_data=input_desc,
            output_data="",
            timestamp=datetime.now(UTC).isoformat(),
            duration_ms=0,
        )
        self._steps.append(step)
        self.step_started.emit(step_id)

        start = time.time()
        try:
            result = await coro
            step.status = "completed"
            step.duration_ms = int((time.time() - start) * 1000)
            step.output_data = self._format_output(result)
            self.step_completed.emit(step_id, {
                "step": step.model_dump(),
                "result": self._serialize_result(result),
            })
            return result
        except Exception as e:
            step.status = "failed"
            step.duration_ms = int((time.time() - start) * 1000)
            step.output_data = f"错误: {e}"
            self.step_failed.emit(step_id, str(e))
            logger.exception("步骤 %s (%s) 执行失败", step_name, step_id)
            return None

    def _finish_workflow(self, final_result: dict[str, Any]) -> None:
        """完成工作流，补充步骤记录并发射完成信号。"""
        final_result["steps"] = [s.model_dump() for s in self._steps]
        self.workflow_completed.emit(final_result)

    @staticmethod
    def _format_output(result: Any, max_len: int = 500) -> str:
        """格式化步骤输出为字符串。"""
        if hasattr(result, "model_dump"):
            text = json.dumps(result.model_dump(), ensure_ascii=False)
        elif isinstance(result, (dict, list)):
            text = json.dumps(result, ensure_ascii=False)
        else:
            text = str(result)
        if len(text) > max_len:
            return text[:max_len] + "..."
        return text

    @staticmethod
    def _serialize_result(result: Any) -> Any:
        """将结果序列化为可被信号传递的 JSON 兼容类型。"""
        if hasattr(result, "model_dump"):
            return result.model_dump()
        if isinstance(result, (str, dict, list, bool, int, float)):
            return result
        return str(result)

    # ────────── 内部：各步骤实现 ──────────

    async def _collect_environment(self, conn_id: str) -> dict[str, str]:
        """采集服务器环境信息。

        通过 SSH 执行预定义的只读命令，收集系统状态。

        Args:
            conn_id: SSH 连接 ID

        Returns:
            命令 → 输出的映射字典
        """
        env_info: dict[str, str] = {}
        if self._ssh is None:
            logger.warning("SSH 管理器未设置，无法采集环境信息")
            return env_info

        for cmd in _ENV_COMMANDS:
            try:
                exit_code, stdout, stderr = await asyncio.to_thread(
                    self._ssh.execute_command, conn_id, cmd, 10,
                )
                if exit_code == 0:
                    env_info[cmd] = stdout.strip()
                else:
                    env_info[cmd] = f"(exit={exit_code}: {stderr.strip()[:200]})"
            except Exception as e:
                env_info[cmd] = f"(执行失败: {e})"
        return env_info

    async def _analyze_with_llm(
        self,
        user_query: str,
        log_text: str,
        env_info: dict[str, str],
    ) -> dict[str, Any]:
        """LLM 分析日志和环境信息。

        LLM 不可用时降级为基于规则的分析。

        Args:
            user_query: 用户问题描述
            log_text: 日志文本
            env_info: 环境信息字典

        Returns:
            包含 analysis 文本和 env_info 的字典
        """
        if not self._llm.available:
            logger.info("LLM 不可用，降级为规则分析")
            suggestion = self._rule_based_analysis(user_query, log_text, env_info)
            return {
                "analysis": suggestion.explanation,
                "suggestion": suggestion,
                "env_info": env_info,
            }

        env_text = "\n".join(
            f"### {cmd}\n{output}" for cmd, output in env_info.items()
        )

        user_prompt = (
            f"## 用户问题\n{user_query}\n\n"
            f"## 日志内容\n{log_text[:8000]}\n\n"
            f"## 服务器环境信息\n{env_text}\n\n"
            "请分析问题根因，并给出一条修复命令。请以 JSON 格式返回（用 ```json 包裹）：\n"
            "```json\n"
            '{"hypothesis": "问题根因假设", '
            '"command": "建议执行的修复命令（单条命令）", '
            '"risk_assessment": "命令风险评估", '
            '"explanation": "命令解释说明"}\n'
            "```"
        )

        try:
            response = await self._llm.chat(_SYSTEM_PROMPT, user_prompt)
            return {"analysis": response, "env_info": env_info}
        except Exception as e:
            logger.warning("LLM 分析失败，降级为规则分析: %s", e)
            suggestion = self._rule_based_analysis(user_query, log_text, env_info)
            return {
                "analysis": suggestion.explanation,
                "suggestion": suggestion,
                "env_info": env_info,
            }

    async def _generate_suggestion(
        self,
        analysis: dict[str, Any],
        env_info: dict[str, str],
    ) -> SuggestionResult:
        """从分析结果生成修复建议。

        Args:
            analysis: 分析结果字典
            env_info: 环境信息字典

        Returns:
            SuggestionResult 实例
        """
        # 如果分析阶段已经降级为规则分析，直接返回
        if "suggestion" in analysis:
            return analysis["suggestion"]

        # 解析 LLM 响应
        llm_text = analysis.get("analysis", "")
        suggestion = self._parse_llm_suggestion(llm_text)
        suggestion.confidence = self._compute_confidence(
            suggestion.hypothesis, analysis.get("env_info", env_info)
        )
        return suggestion

    async def _check_safety(self, command: str) -> SafetyCheckResult:
        """安全检查。

        Args:
            command: 待检查的命令

        Returns:
            SafetyCheckResult 实例
        """
        return self._safety.check(command)

    async def _wait_for_confirmation(
        self,
        suggestion: SuggestionResult,
        safety_result: SafetyCheckResult,
    ) -> bool:
        """等待用户确认是否执行命令。

        发射 confirmation_required 信号，然后等待 approve/reject 调用。

        Args:
            suggestion: 修复建议
            safety_result: 安全检查结果

        Returns:
            True 表示用户批准，False 表示拒绝
        """
        self._confirmation_event = asyncio.Event()
        self._confirmation_approved = False

        self.confirmation_required.emit({
            "suggestion": suggestion.model_dump(),
            "safety": {
                "risk_level": safety_result.risk_level.value,
                "is_allowed": safety_result.is_allowed,
                "reason": safety_result.reason,
                "warnings": safety_result.warnings,
            },
        })

        # 等待用户确认（被 approve_execution / reject_execution 唤醒）
        await self._confirmation_event.wait()
        self._confirmation_event = None
        return self._confirmation_approved

    async def _execute_command(self, conn_id: str, command: str) -> dict[str, Any]:
        """在 SSH 终端执行确认的命令。

        Args:
            conn_id: SSH 连接 ID
            command: 待执行的命令

        Returns:
            包含 exit_code, stdout, stderr, success 的字典
        """
        if self._ssh is None:
            raise RuntimeError("SSH 管理器未设置，无法执行命令")

        exit_code, stdout, stderr = await asyncio.to_thread(
            self._ssh.execute_command, conn_id, command, 60,
        )
        return {
            "exit_code": exit_code,
            "stdout": stdout[:2000],
            "stderr": stderr[:2000],
            "success": exit_code == 0,
        }

    async def _verify_result(
        self,
        conn_id: str,
        env_before: dict[str, str],
        exec_result: dict[str, Any],
        suggestion: SuggestionResult,
    ) -> dict[str, Any]:
        """验证执行结果。

        采集执行后的环境信息，与执行前对比。

        Args:
            conn_id: SSH 连接 ID
            env_before: 执行前的环境信息
            exec_result: 命令执行结果
            suggestion: 修复建议

        Returns:
            验证结果字典
        """
        env_after = await self._collect_environment(conn_id)

        # 对比关键指标变化
        changes: list[str] = []
        for key in env_before:
            before_val = env_before.get(key, "")
            after_val = env_after.get(key, "")
            if before_val != after_val:
                changes.append(f"{key}: 已变化")

        return {
            "exec_success": exec_result.get("success", False),
            "exit_code": exec_result.get("exit_code", -1),
            "env_changed": len(changes) > 0,
            "changes": changes,
            "suggestion": suggestion.model_dump(),
        }

    # ────────── 内部：LLM 响应解析 ──────────

    def _parse_llm_suggestion(self, text: str) -> SuggestionResult:
        """从 LLM 响应中解析修复建议。

        尝试以下顺序：
        1. 从 ```json``` 代码块中提取 JSON
        2. 直接解析整段文本为 JSON
        3. 从 ```bash``` 代码块中提取命令（降级）

        Args:
            text: LLM 响应文本

        Returns:
            SuggestionResult 实例
        """
        # 1) 尝试从 JSON 代码块提取
        json_match = re.search(r"```json\s*(.*?)\s*```", text, re.DOTALL)
        if json_match:
            parsed = self._try_parse_json(json_match.group(1))
            if parsed is not None:
                return SuggestionResult(
                    hypothesis=parsed.get("hypothesis", ""),
                    command=parsed.get("command", ""),
                    risk_assessment=parsed.get("risk_assessment", ""),
                    explanation=parsed.get("explanation", ""),
                )

        # 2) 尝试直接解析整段文本
        parsed = self._try_parse_json(text)
        if parsed is not None:
            return SuggestionResult(
                hypothesis=parsed.get("hypothesis", ""),
                command=parsed.get("command", ""),
                risk_assessment=parsed.get("risk_assessment", ""),
                explanation=parsed.get("explanation", ""),
            )

        # 3) 降级：从 bash 代码块提取命令
        cmd_match = re.search(r"```(?:bash|shell|sh)?\s*(.*?)\s*```", text, re.DOTALL)
        command = cmd_match.group(1).strip() if cmd_match else ""

        return SuggestionResult(
            hypothesis=text[:200],
            command=command,
            explanation=text,
            confidence=0.3,
        )

    @staticmethod
    def _try_parse_json(text: str) -> dict[str, Any] | None:
        """尝试解析 JSON，失败返回 None。"""
        try:
            data = json.loads(text.strip())
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass
        return None

    # ────────── 内部：降级机制 ──────────

    def _rule_based_analysis(
        self,
        user_query: str,
        log_text: str,
        env_info: dict[str, str],
    ) -> SuggestionResult:
        """基于规则的简单分析（LLM 不可用时降级）。

        通过关键词匹配识别常见问题模式，给出只读诊断命令。

        Args:
            user_query: 用户问题描述
            log_text: 日志文本
            env_info: 环境信息

        Returns:
            SuggestionResult 实例（confidence 较低）
        """
        log_lower = log_text.lower()
        query_lower = user_query.lower()

        # 合并日志和用户问题作为分析文本
        combined = f"{log_lower} {query_lower}"

        if any(kw in combined for kw in ["no space left", "disk full", "磁盘满", "空间不足"]):
            return SuggestionResult(
                hypothesis="磁盘空间不足",
                command="df -h",
                risk_assessment="低风险（只读查询）",
                explanation="日志显示磁盘空间不足，建议检查磁盘使用情况",
                confidence=0.6,
            )

        if any(kw in combined for kw in ["permission denied", "权限不足", "access denied"]):
            return SuggestionResult(
                hypothesis="文件权限问题",
                command="ls -la",
                risk_assessment="低风险（只读查询）",
                explanation="日志显示权限被拒绝，建议检查文件权限",
                confidence=0.55,
            )

        if any(kw in combined for kw in ["connection refused", "连接拒绝", "port not listening"]):
            return SuggestionResult(
                hypothesis="服务可能未运行或端口未监听",
                command="ss -tlnp",
                risk_assessment="低风险（只读查询）",
                explanation="日志显示连接被拒绝，建议检查服务状态和端口监听",
                confidence=0.55,
            )

        if any(kw in combined for kw in ["out of memory", "oom", "内存不足", "killed process"]):
            return SuggestionResult(
                hypothesis="内存不足导致进程被杀",
                command="free -m",
                risk_assessment="低风险（只读查询）",
                explanation="日志显示内存不足，建议检查内存使用情况",
                confidence=0.6,
            )

        if any(kw in combined for kw in ["cpu", "load average", "负载高"]):
            return SuggestionResult(
                hypothesis="CPU 负载过高",
                command="ps aux --sort=-%cpu | head -10",
                risk_assessment="低风险（只读查询）",
                explanation="用户反馈 CPU 负载问题，建议查看 CPU 占用最高的进程",
                confidence=0.5,
            )

        if any(kw in combined for kw in ["error", "failed", "exception", "错误", "失败"]):
            return SuggestionResult(
                hypothesis="检测到错误日志，需进一步排查",
                command="journalctl -xe --no-pager -n 50",
                risk_assessment="低风险（只读查询）",
                explanation="日志中检测到错误，建议查看系统日志获取详细信息",
                confidence=0.4,
            )

        # 兜底：无法识别具体问题
        return SuggestionResult(
            hypothesis="无法确定具体问题",
            command="",
            risk_assessment="无",
            explanation=(
                "日志中未检测到明显的错误模式。"
                "建议人工分析日志内容，或提供更详细的错误信息。"
            ),
            confidence=0.2,
        )

    # ────────── 内部：置信度与证据溯源 ──────────

    def _compute_confidence(
        self,
        hypothesis: str,
        env_info: dict[str, str],
    ) -> float:
        """计算建议的置信度。

        基于假设中的关键词是否在环境信息中找到证据支持。

        Args:
            hypothesis: 问题假设文本
            env_info: 环境信息字典

        Returns:
            置信度（0.0-0.95）
        """
        if not hypothesis:
            return 0.0

        # 基础置信度：LLM 给出了假设
        confidence = 0.5

        # 证据溯源：假设关键词在环境信息中出现则提高置信度
        env_text = " ".join(env_info.values()).lower()
        words = re.findall(r"[\w\u4e00-\u9fff]+", hypothesis.lower())
        matched = 0
        for word in words:
            if len(word) > 2 and word in env_text:
                matched += 1

        if words:
            grounding_ratio = matched / len(words)
            confidence += grounding_ratio * 0.3

        return min(confidence, 0.95)
