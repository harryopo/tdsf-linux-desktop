"""
Sidecar-C smolagents Code Agent 适配器（v1.5 占位实现）

v1.5 策略：
- 接口对齐真实 smolagents SDK（CodeAgent + HfApiModel/LiteLLMModel）
- 内部返回 mock 结果，不强制依赖 transformers + torch（~180MB）
- v1.6 升级：替换为真实 CodeAgent + E2B 沙箱执行

设计参考：
- smolagents：HuggingFace 极简 Agent 框架（~1000 行核心代码）
- CodeAgent：生成 Python 代码执行（而非 JSON tool call）
- E2B 集成：use_e2b_executor=True 启用 Firecracker 沙箱
- 模型兼容：HfApiModel / LiteLLMModel / OpenAI / Anthropic

端口：19002（复用 Sidecar-C）
依赖：smolagents（PyPI，v1.6 启用）
"""
import time
import uuid
from typing import Any
from pydantic import BaseModel
import logging

logger = logging.getLogger("smolagents-adapter")


# ============================================================
# Pydantic 模型
# ============================================================

class CodeTaskRequest(BaseModel):
    """Code Agent 任务请求"""
    task: str  # 自然语言任务描述
    context: dict = {}  # 上下文（文件 / 命令 / 错误信息）
    model_id: str = "default"  # 模型 ID（如 meta-llama/Llama-3.3-70B-Instruct）
    use_e2b: bool = False  # 是否使用 E2B 沙箱执行


class CodeTaskResponse(BaseModel):
    """Code Agent 任务响应"""
    plan: str  # 计划（自然语言）
    steps: list[str]  # 执行步骤
    code: str | None = None  # 生成的代码（如果有）
    result: Any = None  # 执行结果
    confidence: float
    method: str  # "smolagents-placeholder" / "smolagents-real"
    duration_ms: int


class ModelInfoResponse(BaseModel):
    """模型信息响应"""
    model_id: str
    provider: str  # "huggingface" / "openai" / "anthropic" / "litellm"
    ready: bool
    note: str


# ============================================================
# smolagents 适配器（v1.5 占位实现）
# ============================================================

class SmolagentsAdapter:
    """smolagents Code Agent 适配器（占位实现）"""

    def __init__(self):
        self._smolagents_available = False
        try:
            import smolagents
            self._smolagents_available = True
            logger.info("smolagents 真实库已加载（版本：%s）", getattr(smolagents, '__version__', 'unknown'))
        except ImportError:
            logger.warning("smolagents 未安装，将使用占位实现（v1.5）")

    async def code_task(self, req: CodeTaskRequest) -> CodeTaskResponse:
        """执行 Code Agent 任务（占位：返回 mock 结果）"""
        start = time.time()

        # 如果 smolagents 可用，尝试真实执行
        if self._smolagents_available:
            try:
                return await self._real_code_task(req)
            except Exception as e:
                logger.warning("smolagents 真实执行失败，降级到占位：%s", e)

        # 占位实现
        return self._placeholder_response(req, start)

    async def _real_code_task(self, req: CodeTaskRequest) -> CodeTaskResponse:
        """真实 smolagents 执行（v1.6 主力路径，v1.5 可选）"""
        from smolagents import CodeAgent, HfApiModel, LiteLLMModel

        # 选择模型
        if req.model_id.startswith("openai/") or req.model_id.startswith("gpt"):
            model = LiteLLMModel(model_id=req.model_id)
        else:
            model = HfApiModel(model_id=req.model_id)

        # 创建 CodeAgent
        agent = CodeAgent(
            tools=[],
            model=model,
            add_base_tools=False,
            use_e2b_executor=req.use_e2b,
        )

        # 执行任务
        result = agent.run(req.task)
        duration_ms = int((time.time() - start) * 1000)

        return CodeTaskResponse(
            plan=f"真实执行：{req.task[:50]}",
            steps=["分析任务", "生成代码", "执行代码", "返回结果"],
            code=getattr(result, 'code', None),
            result=str(result),
            confidence=0.9,
            method="smolagents-real",
            duration_ms=duration_ms,
        )

    def _placeholder_response(self, req: CodeTaskRequest, start: float) -> CodeTaskResponse:
        """占位响应（v1.5 默认）"""
        duration_ms = int((time.time() - start) * 1000)

        # 根据任务类型生成更真实的占位计划
        task_lower = req.task.lower()
        if "nginx" in task_lower or "502" in task_lower:
            plan = "占位计划：分析 Nginx 502 错误日志"
            steps = [
                "v1.5 占位步骤 1：解析 Nginx 错误日志（mock）",
                "v1.5 占位步骤 2：定位 upstream 连接失败（mock）",
                "v1.5 占位步骤 3：检查 upstream 服务状态（mock）",
            ]
        elif "python" in task_lower or "代码" in task_lower:
            plan = "占位计划：Python 代码分析与修复"
            steps = [
                "v1.5 占位步骤 1：静态分析代码结构（mock）",
                "v1.5 占位步骤 2：识别潜在问题（mock）",
                "v1.5 占位步骤 3：生成修复建议（mock）",
            ]
        else:
            plan = f"占位计划：分析任务 '{req.task[:50]}'（v1.5 不执行实际代码）"
            steps = [
                "v1.5 占位步骤 1：解析任务（mock）",
                "v1.5 占位步骤 2：执行（mock）",
                "v1.5 占位步骤 3：返回结果（mock）",
            ]

        return CodeTaskResponse(
            plan=plan,
            steps=steps,
            confidence=0.5,
            method="smolagents-placeholder-v1.5",
            duration_ms=duration_ms,
        )

    async def get_model_info(self, model_id: str = "default") -> ModelInfoResponse:
        """获取模型信息"""
        if self._smolagents_available:
            return ModelInfoResponse(
                model_id=model_id,
                provider="huggingface",
                ready=True,
                note="v1.5 smolagents 已安装，可真实执行",
            )
        return ModelInfoResponse(
            model_id=model_id,
            provider="none",
            ready=False,
            note="v1.5 占位：smolagents 未安装，v1.6 升级",
        )


# ============================================================
# 单例
# ============================================================

_adapter: SmolagentsAdapter | None = None


def get_smolagents_adapter() -> SmolagentsAdapter:
    global _adapter
    if _adapter is None:
        _adapter = SmolagentsAdapter()
    return _adapter
