"""
Sidecar-A 入口：FastAPI 服务器（端口 19000）

v1.5 升级：E2B Firecracker 沙箱 + OpenDerisk LLM 增强 + Drain3 持久化

设计参考：
- VS Code Language Server：localhost + stdio 双模式
- JupyterLab：FastAPI + uvicorn 单进程
- E2B Firecracker microVM：~125ms 启动，kernel 级隔离
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any
import uvicorn
import asyncio
import logging
import os
import sys
import time

from drain3_adapter import Drain3Adapter
from open_derisk_adapter import OpenDeriskAdapter
from e2b_adapter import get_e2b_adapter

# ============================================================
# 空闲退出握手（D3：idle_shutdown_request 先征求宿主同意再退）
#
# 立场：侧车**永不自己消失**。空闲到点了它只把"我想退"写进 /health，
# 真退要等宿主 POST /host/idle-shutdown-consent 批准 —— 否则宿主那边的
# 重启预算会把这看成异常退出，立刻再拉一个起来，两边对着拉锯。
#
# /health 不算活动：宿主的存活轮询每几秒就来一次，把它算成活动的话
# 侧车永远不会空闲，这个功能就成了摆设。
# ============================================================
IDLE_SHUTDOWN_AFTER_S = float(os.environ.get('TDSF_SIDECAR_IDLE_SHUTDOWN_S', '900'))
IDLE_CHECK_INTERVAL_S = float(os.environ.get('TDSF_SIDECAR_IDLE_CHECK_S', '5'))

_last_activity = time.monotonic()
_inflight = 0
_shutdown_requested = False


def _mark_activity() -> None:
    global _last_activity
    _last_activity = time.monotonic()


async def _idle_watch() -> None:
    global _shutdown_requested
    while True:
        await asyncio.sleep(IDLE_CHECK_INTERVAL_S)
        if _shutdown_requested or _inflight > 0:
            continue
        if time.monotonic() - _last_activity >= IDLE_SHUTDOWN_AFTER_S:
            _shutdown_requested = True
            logger.info(
                f'[sidecar] 空闲 {int(IDLE_SHUTDOWN_AFTER_S)} 秒，向宿主提出退出请求（等宿主批准，不自己退）'
            )


async def _lifespan(_app: FastAPI):
    task = asyncio.create_task(_idle_watch())
    try:
        yield
    finally:
        task.cancel()


# ============================================================
# 日志配置
# ============================================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    stream=sys.stderr,
)
logger = logging.getLogger("sidecar-a")

# ============================================================
# FastAPI 应用
# ============================================================
app = FastAPI(
    title="TDSF Sidecar-A",
    description="SRE 诊断 + 日志解析 + E2B 沙箱（v1.5）",
    version="1.5.0",
    lifespan=_lifespan,
)


@app.middleware('http')
async def track_activity(request, call_next):
    """把真实工作请求算作活动；/health 是宿主的存活轮询，不算活动"""
    global _inflight
    is_health = request.url.path == '/health'
    if not is_health:
        _inflight += 1
        _mark_activity()
    try:
        response = await call_next(request)
    finally:
        if not is_health:
            _inflight -= 1
            _mark_activity()
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:*", "http://localhost:*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# ============================================================
# 单例 Adapter
# ============================================================
drain3 = Drain3Adapter()
open_derisk = OpenDeriskAdapter()
e2b = get_e2b_adapter()

START_TIME = time.time()


# ============================================================
# Pydantic 模型
# ============================================================

class HealthResponse(BaseModel):
    status: str
    version: str
    adapters: dict
    uptime_seconds: float
    # 空闲退出握手：为 true 表示"侧车想退，正等宿主批准"（它自己不会退）
    idle_shutdown_request: bool = False
    idle_seconds: float = 0.0


class LogParseRequest(BaseModel):
    log_lines: list[str]
    max_clusters: int = 50


class LogParseResponse(BaseModel):
    templates: list[dict]
    total_lines: int
    unique_templates: int


class SreDiagnoseRequest(BaseModel):
    log_templates: list[dict]
    service_name: str = "unknown"
    extra_context: dict = {}
    llm_config: dict | None = None


class SreDiagnoseResponse(BaseModel):
    root_cause: str
    confidence: float
    severity: str
    recommendations: list[str]
    reasoning: list[str]
    source: str
    related_risks: list[str] = []
    rule_confidence: float | None = None
    llm_confidence: float | None = None


class PipelineRequest(BaseModel):
    log_lines: list[str]
    service_name: str = "unknown"
    max_clusters: int = 50
    llm_config: dict = None


class PipelineResponse(BaseModel):
    parse: LogParseResponse
    diagnose: SreDiagnoseResponse


# ============================================================
# E2B 模型（v1.5 新增）
# ============================================================

class SandboxCreateRequest(BaseModel):
    template: str = "base"
    timeout: int = 300
    metadata: dict = {}


class SandboxCreateResponse(BaseModel):
    sandbox_id: str
    template: str
    status: str
    created_at: float
    timeout: int
    message: str = ""


class SandboxRunCodeRequest(BaseModel):
    code: str
    timeout: int = 30


class SandboxRunCodeResponse(BaseModel):
    execution_id: str
    stdout: str
    stderr: str
    exit_code: int
    duration_ms: int
    result: Any = None


class SandboxKillRequest(BaseModel):
    sandbox_id: str


class SandboxKillResponse(BaseModel):
    ok: bool
    message: str


class SandboxListResponse(BaseModel):
    sandboxes: list[dict]


# ============================================================
# 端点 1：健康检查
# ============================================================
@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok",
        version="1.5.0",
        adapters={
            "drain3": drain3.status(),
            "open_derisk": open_derisk.status(),
            "e2b": {"ready": True, "mode": "placeholder-v1.5", "note": "v1.5 占位，v1.6 集成真实 E2B SDK"},
        },
        uptime_seconds=time.time() - START_TIME,
        idle_shutdown_request=_shutdown_requested,
        idle_seconds=max(0.0, time.monotonic() - _last_activity),
    )


class IdleConsentRequest(BaseModel):
    approve: bool


class IdleConsentResponse(BaseModel):
    ok: bool
    exiting: bool


@app.post('/host/idle-shutdown-consent', response_model=IdleConsentResponse)
async def idle_shutdown_consent(req: IdleConsentRequest):
    """宿主对空闲退出请求的答复：批准才退（由本端主动结束进程），拒绝就重新计时继续服务"""
    global _shutdown_requested
    if not _shutdown_requested:
        # 没有请求就被答复：可能是宿主重发或乱序。不因此退出——无声退出正是这个握手要防的事
        return IdleConsentResponse(ok=False, exiting=False)
    if not req.approve:
        _shutdown_requested = False
        _mark_activity()
        logger.info('[sidecar] 宿主拒绝本次空闲退出，继续服务并重新计时')
        return IdleConsentResponse(ok=True, exiting=False)
    _shutdown_requested = False
    logger.info('[sidecar] 宿主已批准空闲退出，5 秒后结束进程（先让本次响应发出去）')
    loop = asyncio.get_running_loop()
    loop.call_later(5.0, lambda: os._exit(0))
    return IdleConsentResponse(ok=True, exiting=True)


# ============================================================
# 端点 2：Drain3 日志模板解析
# ============================================================
@app.post("/drain3/parse", response_model=LogParseResponse)
async def drain3_parse(req: LogParseRequest):
    if not req.log_lines:
        raise HTTPException(status_code=400, detail="log_lines 不能为空")
    try:
        result = drain3.parse(req.log_lines, max_clusters=req.max_clusters)
        return LogParseResponse(
            templates=result["templates"],
            total_lines=result["total_lines"],
            unique_templates=result["unique_templates"],
        )
    except Exception as e:
        logger.exception("Drain3 解析失败")
        raise HTTPException(status_code=500, detail=f"Drain3 解析失败：{e}")


# ============================================================
# 端点 3：OpenDerisk SRE 根因诊断
# ============================================================
@app.post("/sre/diagnose", response_model=SreDiagnoseResponse)
async def sre_diagnose(req: SreDiagnoseRequest):
    if not req.log_templates:
        raise HTTPException(status_code=400, detail="log_templates 不能为空")
    try:
        result = open_derisk.diagnose(
            log_templates=req.log_templates,
            service_name=req.service_name,
            extra_context=req.extra_context,
            llm_config=req.llm_config,
        )
        return SreDiagnoseResponse(**result)
    except Exception as e:
        logger.exception("OpenDerisk 诊断失败")
        raise HTTPException(status_code=500, detail=f"OpenDerisk 诊断失败：{e}")


# ============================================================
# 端点 4：端到端 pipeline
# ============================================================
@app.post("/pipeline/run", response_model=PipelineResponse)
async def pipeline_run(req: PipelineRequest):
    parse_resp = await drain3_parse(LogParseRequest(
        log_lines=req.log_lines,
        max_clusters=req.max_clusters,
    ))
    diagnose_resp = await sre_diagnose(SreDiagnoseRequest(
        log_templates=parse_resp.templates,
        service_name=req.service_name,
        llm_config=req.llm_config,
    ))
    return PipelineResponse(parse=parse_resp, diagnose=diagnose_resp)


# ============================================================
# 端点 5-8：E2B Firecracker 沙箱（v1.5 占位）
# ============================================================

@app.post("/sandbox/create", response_model=SandboxCreateResponse)
async def sandbox_create(req: SandboxCreateRequest):
    """创建 Firecracker microVM 沙箱（占位实现）"""
    try:
        result = await e2b.create_sandbox(
            template=req.template,
            timeout=req.timeout,
            metadata=req.metadata,
        )
        return result
    except Exception as e:
        logger.exception("创建沙箱失败")
        raise HTTPException(status_code=500, detail=f"创建沙箱失败：{e}")


@app.post("/sandbox/run", response_model=SandboxRunCodeResponse)
async def sandbox_run(req: SandboxRunCodeRequest, sandbox_id: str):
    """在沙箱中执行代码（占位实现）"""
    try:
        result = await e2b.run_code(sandbox_id, req.code, timeout=req.timeout)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("执行代码失败")
        raise HTTPException(status_code=500, detail=f"执行代码失败：{e}")


@app.post("/sandbox/kill", response_model=SandboxKillResponse)
async def sandbox_kill(req: SandboxKillRequest):
    """销毁沙箱"""
    try:
        result = await e2b.kill_sandbox(req.sandbox_id)
        return result
    except Exception as e:
        logger.exception("销毁沙箱失败")
        raise HTTPException(status_code=500, detail=f"销毁沙箱失败：{e}")


@app.get("/sandbox/list", response_model=SandboxListResponse)
async def sandbox_list():
    """列出所有活跃沙箱"""
    try:
        result = e2b.list_sandboxes()
        return result
    except Exception as e:
        logger.exception("列出沙箱失败")
        raise HTTPException(status_code=500, detail=f"列出沙箱失败：{e}")


# ============================================================
# 入口
# ============================================================
if __name__ == "__main__":
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=19000,
        log_level="info",
        log_config=None,
    )
