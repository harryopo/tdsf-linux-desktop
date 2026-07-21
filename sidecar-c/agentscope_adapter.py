"""
Sidecar-C AgentScope 多 Agent 编排适配器（v1.5 占位实现）

v1.5 策略：
- 接口对齐真实 AgentScope 2.0 API（ModelScopeAgent + MsgHub + AgentFiber）
- 内部返回 mock 轨迹，不强制依赖 agentscope + torch（~180MB）
- v1.6 升级：替换为真实多 Agent 编排（planner → executor → reviewer）

设计参考：
- AgentScope 2.0：阿里巴巴多 Agent 编排框架（27k+ stars）
- 架构：ModelScopeAgent + MsgHub（消息总线）+ AgentFiber（编排）
- 并行模式：ParallelAgent + GroupChat（多 Agent 协作）
- 与 smolagents 互补：smolagents 偏单 agent code 任务，AgentScope 偏多 agent workflow

端口：19002（复用 Sidecar-C）
依赖：agentscope（PyPI，v1.6 启用）
"""
import time
import uuid
from typing import Any
from pydantic import BaseModel
import logging

logger = logging.getLogger("agentscope-adapter")


# ============================================================
# Pydantic 模型
# ============================================================

class MultiAgentRequest(BaseModel):
    """多 Agent 编排请求"""
    task: str
    agents: list[str] = ["planner", "executor", "reviewer"]  # Agent 角色列表
    max_rounds: int = 5  # 最大对话轮数


class MultiAgentResponse(BaseModel):
    """多 Agent 编排响应"""
    final_answer: str
    agent_trace: list[dict]  # 各 Agent 的执行轨迹
    method: str  # "agentscope-placeholder" / "agentscope-real"
    duration_ms: int


class AgentInfoResponse(BaseModel):
    """Agent 信息响应"""
    name: str
    role: str  # "planner" / "executor" / "reviewer"
    ready: bool
    note: str


# ============================================================
# AgentScope 适配器（v1.5 占位实现）
# ============================================================

class AgentScopeAdapter:
    """AgentScope 多 Agent 编排适配器（占位实现）"""

    def __init__(self):
        self._agentscope_available = False
        try:
            import agentscope
            self._agentscope_available = True
            logger.info("AgentScope 真实库已加载（版本：%s）", getattr(agentscope, '__version__', 'unknown'))
        except ImportError:
            logger.warning("AgentScope 未安装，将使用占位实现（v1.5）")

    async def multi_agent(self, req: MultiAgentRequest) -> MultiAgentResponse:
        """多 Agent 编排（占位：返回 mock 轨迹）"""
        start = time.time()

        # 如果 AgentScope 可用，尝试真实执行
        if self._agentscope_available:
            try:
                return await self._real_multi_agent(req)
            except Exception as e:
                logger.warning("AgentScope 真实执行失败，降级到占位：%s", e)

        # 占位实现
        return self._placeholder_response(req, start)

    async def _real_multi_agent(self, req: MultiAgentRequest) -> MultiAgentResponse:
        """真实 AgentScope 执行（v1.6 主力路径，v1.5 可选）"""
        from agentscope.agents import ModelScopeAgent
        from agentscope.msg import Msg

        # 创建多 Agent
        agents = []
        for role in req.agents:
            agent = ModelScopeAgent(
                name=role,
                sys_prompt=f"You are a {role} agent. Help the user with {role} tasks.",
            )
            agents.append(agent)

        # 简单并行执行（v1.6 会使用更复杂的编排）
        traces = []
        for agent in agents:
            msg = Msg(name="user", content=req.task, role="user")
            response = await agent(msg)
            traces.append({
                "agent": agent.name,
                "role": role,
                "input": req.task[:100],
                "output": str(response.content)[:200],
            })

        duration_ms = int((time.time() - start) * 1000)
        final_answer = f"[真实多 Agent 结果] 来自 {len(agents)} 个 agent 的协作结果"

        return MultiAgentResponse(
            final_answer=final_answer,
            agent_trace=traces,
            method="agentscope-real",
            duration_ms=duration_ms,
        )

    def _placeholder_response(self, req: MultiAgentRequest, start: float) -> MultiAgentResponse:
        """占位响应（v1.5 默认）"""
        duration_ms = int((time.time() - start) * 1000)

        # 根据 agent 列表生成轨迹
        traces = []
        for role in req.agents:
            if role == "planner":
                output = f"规划：分析任务 '{req.task[:30]}'"
            elif role == "executor":
                output = "占位执行（mock）"
            elif role == "reviewer":
                output = "占位审查（mock）"
            else:
                output = f"占位 {role}（mock）"

            traces.append({
                "agent": role,
                "role": role,
                "input": req.task[:100],
                "output": output,
            })

        return MultiAgentResponse(
            final_answer=f"占位最终答案：{req.task[:50]}（v1.5 不实际执行）",
            agent_trace=traces,
            method="agentscope-placeholder-v1.5",
            duration_ms=duration_ms,
        )

    async def list_agents(self) -> list[AgentInfoResponse]:
        """列出可用 Agent 类型"""
        agents = [
            AgentInfoResponse(
                name="planner",
                role="planner",
                ready=self._agentscope_available,
                note="v1.5 占位：任务规划 agent" if not self._agentscope_available else "v1.5 真实可用",
            ),
            AgentInfoResponse(
                name="executor",
                role="executor",
                ready=self._agentscope_available,
                note="v1.5 占位：任务执行 agent" if not self._agentscope_available else "v1.5 真实可用",
            ),
            AgentInfoResponse(
                name="reviewer",
                role="reviewer",
                ready=self._agentscope_available,
                note="v1.5 占位：结果审查 agent" if not self._agentscope_available else "v1.5 真实可用",
            ),
        ]
        return agents


# ============================================================
# 单例
# ============================================================

_adapter: AgentScopeAdapter | None = None


def get_agentscope_adapter() -> AgentScopeAdapter:
    global _adapter
    if _adapter is None:
        _adapter = AgentScopeAdapter()
    return _adapter
