"""
Sidecar-C 入口：Agent 编排 + Code Agent（端口 19002）

v1.5 升级：smolagents + AgentScope 占位实现（接口对齐真实 SDK）

设计参考：
- smolagents：HuggingFace 极简 CodeAgent（~1000 行核心代码）
- AgentScope：阿里多 Agent 编排（27k+ stars，planner→executor→reviewer）
- E2B：Firecracker 沙箱代码执行（use_e2b_executor=True）
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any
import uvicorn
import logging
import sys
import time

from smolagents_adapter import get_smolagents_adapter
from agentscope_adapter import get_agentscope_adapter

# ============================================================
# 日志配置
# ============================================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    stream=sys.stderr,
)
logger = logging.getLogger("sidecar-c")

# ============================================================
# FastAPI 应用
# ============================================================
app = FastAPI(
    title="TDSF Sidecar-C",
    description="Agent 编排 + Code Agent（v1.5）",
    version="1.5.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:*", "http://localhost:*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# ============================================================
# 单例 Adapter
# ============================================================
smolagents = get_smolagents_adapter()
agentscope = get_agentscope_adapter()

START_TIME = time.time()


# ============================================================
# Pydantic 模型
# ============================================================

class HealthResponse(BaseModel):
    status: str
    version: str
    adapters: dict
    uptime_seconds: float


class CodeTaskRequest(BaseModel):
    """Code Agent 任务请求（v1.5）"""
    task: str
    context: dict = {}
    model_id: str = "default"
    use_e2b: bool = False


class CodeTaskResponse(BaseModel):
    """Code Agent 任务响应（v1.5）"""
    plan: str
    steps: list[str]
    code: str | None = None
    result: Any = None
    confidence: float
    method: str
    duration_ms: int


class MultiAgentRequest(BaseModel):
    """多 Agent 编排请求（v1.5）"""
    task: str
    agents: list[str] = ["planner", "executor", "reviewer"]
    max_rounds: int = 5


class MultiAgentResponse(BaseModel):
    """多 Agent 编排响应（v1.5）"""
    final_answer: str
    agent_trace: list[dict]
    method: str
    duration_ms: int


class ModelInfoResponse(BaseModel):
    """模型信息响应"""
    model_id: str
    provider: str
    ready: bool
    note: str


class AgentInfoResponse(BaseModel):
    """Agent 信息响应"""
    name: str
    role: str
    ready: bool
    note: str


# ============================================================
# 端点 1：健康检查
# ============================================================
@app.get("/health", response_model=HealthResponse)
async def health():
    """健康检查：Electron 主进程 spawn 后调用确认 sidecar 就绪"""
    return HealthResponse(
        status="ok",
        version="1.5.0",
        adapters={
            "smolagents": {
                "ready": smolagents._smolagents_available,
                "mode": "real-v1.5" if smolagents._smolagents_available else "placeholder-v1.5",
                "note": "v1.5 真实集成 smolagents" if smolagents._smolagents_available else "v1.5 占位 - smolagents 未安装",
            },
            "agentscope": {
                "ready": agentscope._agentscope_available,
                "mode": "real-v1.5" if agentscope._agentscope_available else "placeholder-v1.5",
                "note": "v1.5 真实集成 AgentScope" if agentscope._agentscope_available else "v1.5 占位 - AgentScope 未安装",
            },
        },
        uptime_seconds=time.time() - START_TIME,
    )


# ============================================================
# 端点 2：smolagents Code Agent（v1.5 占位 / v1.6 真实）
# ============================================================
@app.post("/agent/code-task", response_model=CodeTaskResponse)
async def code_task(req: CodeTaskRequest):
    """
    smolagents Code Agent（v1.5 占位实现）

    v1.5 返回：固定 plan + 步骤 + 0.5 置信度
    v1.6 升级：真实 smolagents + E2B 沙箱执行

    为什么 v1.5 不集成：
    - smolagents 依赖 transformers 4.36 + torch 2.1（~180MB 体积）
    - 1 周冲刺优先 Sidecar-A/B 完善
    - smolagents 极简范式（2 行代码）可后续 v1.6 集成
    """
    logger.info(f"smolagents 请求：task={req.task[:80]}")
    try:
        result = await smolagents.code_task(req)
        return result
    except Exception as e:
        logger.exception("smolagents 执行失败")
        raise HTTPException(status_code=500, detail=f"smolagents 执行失败：{e}")


# ============================================================
# 端点 3：AgentScope 多 Agent 编排（v1.5 占位 / v1.6 真实）
# ============================================================
@app.post("/agent/multi", response_model=MultiAgentResponse)
async def multi_agent(req: MultiAgentRequest):
    """
    AgentScope 多 Agent 编排（v1.5 占位）

    v1.5 返回：固定 agent 轨迹 + 0.5 置信度
    v1.6 升级：真实 AgentScope 2.0 编排（planner → executor → reviewer）

    集成价值：
    - 工业级多 Agent 编排（27k+ stars）
    - 与 smolagents 互补（smolagents 偏单 agent code 任务，AgentScope 偏多 agent workflow）
    """
    logger.info(f"AgentScope 请求：task={req.task[:80]}, agents={req.agents}")
    try:
        result = await agentscope.multi_agent(req)
        return result
    except Exception as e:
        logger.exception("AgentScope 执行失败")
        raise HTTPException(status_code=500, detail=f"AgentScope 执行失败：{e}")


# ============================================================
# 端点 4：模型信息（v1.5 新增）
# ============================================================
@app.get("/agent/model-info", response_model=ModelInfoResponse)
async def model_info(model_id: str = "default"):
    """获取模型信息（smolagents 可用模型列表）"""
    try:
        result = await smolagents.get_model_info(model_id)
        return result
    except Exception as e:
        logger.exception("获取模型信息失败")
        raise HTTPException(status_code=500, detail=f"获取模型信息失败：{e}")


# ============================================================
# 端点 5：Agent 列表（v1.5 新增）
# ============================================================
@app.get("/agent/list", response_model=list[AgentInfoResponse])
async def agent_list():
    """列出可用 Agent 类型（AgentScope roles）"""
    try:
        result = await agentscope.list_agents()
        return result
    except Exception as e:
        logger.exception("获取 Agent 列表失败")
        raise HTTPException(status_code=500, detail=f"获取 Agent 列表失败：{e}")


# ============================================================
# 入口
# ============================================================
if __name__ == "__main__":
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=19002,
        log_level="info",
        log_config=None,
    )
