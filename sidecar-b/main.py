"""
Sidecar-B 入口：Analytics + 因果推断 + 可观测性（端口 19001）

v1.5 升级：真实集成 DoWhy + EconML（因果推断四步工作流）

设计参考：
- DoWhy 0.11：建模 → 识别 → 估计 → 反驳
- EconML 0.15：Double Machine Learning + Causal Forest
- Arize Phoenix：OTel 链路追踪（v1.5 占位，v1.6 升级）
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any
import uvicorn
import logging
import sys
import time

from dowhy_adapter import get_dowhy_adapter

# ============================================================
# 日志配置
# ============================================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    stream=sys.stderr,
)
logger = logging.getLogger("sidecar-b")

# ============================================================
# FastAPI 应用
# ============================================================
app = FastAPI(
    title="TDSF Sidecar-B",
    description="Analytics + 因果推断 + 可观测性（v1.5）",
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
dowhy_adapter = get_dowhy_adapter()

START_TIME = time.time()


# ============================================================
# Pydantic 模型
# ============================================================

class HealthResponse(BaseModel):
    status: str
    version: str
    adapters: dict
    uptime_seconds: float


class CausalRequest(BaseModel):
    """因果推断请求"""
    treatment: str
    outcome: str
    confounders: list[str] = []
    effect_modifiers: list[str] = []
    data: list[dict[str, Any]]
    method: str = "backdoor"
    estimate_method: str = "linear"


class CausalResponse(BaseModel):
    """因果推断响应"""
    effect: float
    confidence: float
    method: str
    graph_summary: str
    reasoning: list[str]
    cate: list[dict[str, Any]] | None = None
    refutation: dict[str, Any] | None = None


class TelemetryRequest(BaseModel):
    """Phoenix OTel 埋点请求（v1.5 占位）"""
    trace_id: str
    span_name: str
    attributes: dict = {}


class TelemetryResponse(BaseModel):
    """Phoenix OTel 埋点响应（v1.5 占位）"""
    accepted: bool
    endpoint: str


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
            "dowhy": {
                "ready": True,
                "mode": "real-v1.5" if dowhy_adapter._dowhy_available else "placeholder-v1.5",
                "note": "v1.5 真实集成 DoWhy + EconML" if dowhy_adapter._dowhy_available else "v1.5 占位 - DoWhy 未安装",
            },
            "phoenix": {"ready": False, "note": "v1.5 占位 - 待 v1.6 集成"},
        },
        uptime_seconds=time.time() - START_TIME,
    )


# ============================================================
# 端点 2：DoWhy 因果推断（v1.5 真实集成）
# ============================================================
@app.post("/analytics/dowhy", response_model=CausalResponse)
async def causal_analyze(req: CausalRequest):
    """
    DoWhy 因果图推理（v1.5 真实集成）

    四步工作流：
    1. 建模：构建 DAG（treatment → outcome，confounders → both）
    2. 识别：识别可估计的因果效应（backdoor / iv / frontdoor）
    3. 估计：计算 ATE（平均处理效应）+ 可选 CATE（条件效应）
    4. 反驳：验证结果鲁棒性（random_common_cause）

    估计方法：
    - linear：线性回归（默认，无需 EconML）
    - dml：Double Machine Learning（需 EconML）
    - dr：Doubly Robust（需 EconML）
    - forest：Causal Forest（需 EconML）
    """
    logger.info(
        f"DoWhy 因果推断：treatment={req.treatment}, outcome={req.outcome}, "
        f"confounders={len(req.confounders)}, method={req.estimate_method}"
    )
    try:
        result = await dowhy_adapter.causal_analyze(req)
        return result
    except Exception as e:
        logger.exception("DoWhy 因果推断失败")
        raise HTTPException(status_code=500, detail=f"DoWhy 因果推断失败：{e}")


# ============================================================
# 端点 3：Phoenix OTel 埋点（v1.5 占位）
# ============================================================
@app.post("/analytics/phoenix", response_model=TelemetryResponse)
async def phoenix_emit(req: TelemetryRequest):
    """
    Arize Phoenix OTel 埋点（v1.5 占位）

    v1.5 返回：accepted=True + endpoint="phoenix-placeholder"
    v1.6 升级：完整 OTel collector + span/trace 上报
    """
    logger.info(f"Phoenix 占位：trace_id={req.trace_id}, span={req.span_name}")
    return TelemetryResponse(
        accepted=True,
        endpoint="phoenix-placeholder-v1.5",
    )


# ============================================================
# 入口
# ============================================================
if __name__ == "__main__":
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=19001,
        log_level="info",
        log_config=None,
    )
