"""
Sidecar-A E2B Firecracker 沙箱适配器（v1.5 占位实现）

v1.5 策略：
- 接口对齐真实 E2B SDK（e2b / e2b-code-interpreter）
- 内部返回 mock 结果，不强制依赖 E2B API Key
- v1.6 升级：替换为真实 Sandbox.create() + run_code() 调用

设计参考：
- E2B Firecracker microVM：~125ms 启动，kernel 级隔离
- E2B Code Interpreter：Jupyter 内核，有状态执行
- 开源核心：github.com/e2b-dev/e2b（可自托管）

端口：19000（复用 Sidecar-A）
依赖：e2b（PyPI 2.23.1，v1.6 启用）
"""
import time
import uuid
from typing import Any
from pydantic import BaseModel
import logging

logger = logging.getLogger("e2b-adapter")


# ============================================================
# Pydantic 模型
# ============================================================

class SandboxCreateRequest(BaseModel):
    """创建沙箱请求"""
    template: str = "base"  # 模板 ID（base/python/node）
    timeout: int = 300  # 超时秒数（默认 5 分钟）
    metadata: dict[str, Any] = {}


class SandboxCreateResponse(BaseModel):
    """创建沙箱响应"""
    sandbox_id: str
    template: str
    status: str  # "running" | "starting" | "error"
    created_at: float
    timeout: int
    message: str = ""


class SandboxRunCodeRequest(BaseModel):
    """运行代码请求"""
    code: str
    timeout: int = 30  # 单次执行超时


class SandboxRunCodeResponse(BaseModel):
    """运行代码响应"""
    execution_id: str
    stdout: str
    stderr: str
    exit_code: int
    duration_ms: int
    result: Any = None  # 结构化结果（如图表）


class SandboxKillRequest(BaseModel):
    """销毁沙箱请求"""
    sandbox_id: str


class SandboxKillResponse(BaseModel):
    """销毁沙箱响应"""
    ok: bool
    message: str


class SandboxListResponse(BaseModel):
    """列出沙箱响应"""
    sandboxes: list[dict[str, Any]]


# ============================================================
# E2B 适配器（v1.5 占位实现）
# ============================================================

class E2BAdapter:
    """E2B Firecracker 沙箱适配器（占位实现）"""

    def __init__(self):
        self._sandboxes: dict[str, dict[str, Any]] = {}
        logger.info("E2B 适配器初始化完成（v1.5 占位模式，不依赖 E2B API Key）")

    async def create_sandbox(
        self,
        template: str = "base",
        timeout: int = 300,
        metadata: dict[str, Any] | None = None,
    ) -> SandboxCreateResponse:
        """创建沙箱（占位：返回 mock 沙箱 ID）"""
        sandbox_id = f"sandbox-{uuid.uuid4().hex[:8]}"
        created_at = time.time()

        # 存储沙箱元数据
        self._sandboxes[sandbox_id] = {
            "template": template,
            "timeout": timeout,
            "created_at": created_at,
            "status": "running",
            "metadata": metadata or {},
        }

        logger.info(f"E2B 占位：创建沙箱 {sandbox_id}（template={template}, timeout={timeout}s）")

        return SandboxCreateResponse(
            sandbox_id=sandbox_id,
            template=template,
            status="running",
            created_at=created_at,
            timeout=timeout,
            message="v1.5 占位：模拟 Firecracker microVM 启动（~125ms）",
        )

    async def run_code(
        self,
        sandbox_id: str,
        code: str,
        timeout: int = 30,
    ) -> SandboxRunCodeResponse:
        """在沙箱中执行代码（占位：返回 mock 结果）"""
        if sandbox_id not in self._sandboxes:
            raise ValueError(f"沙箱不存在：{sandbox_id}")

        start = time.time()
        execution_id = f"exec-{uuid.uuid4().hex[:8]}"

        # 模拟代码执行（实际 E2B 在 Firecracker microVM 中运行）
        try:
            # 安全检查：禁止危险操作
            dangerous = ["rm -rf /", "shutdown", "reboot", ":(){:|:&};:"]
            if any(d in code for d in dangerous):
                raise PermissionError("检测到危险命令，拒绝执行")

            # Mock 执行结果
            stdout = f"[E2B 占位] 代码已接收（{len(code)} 字符）\n"
            stdout += f"沙箱：{sandbox_id}\n"
            stdout += f"模板：{self._sandboxes[sandbox_id]['template']}\n"
            stdout += "v1.5 不执行真实代码（需 v1.6 集成 e2b-code-interpreter）"

            stderr = ""
            exit_code = 0
            result = None
        except Exception as e:
            stdout = ""
            stderr = str(e)
            exit_code = 1
            result = None

        duration_ms = int((time.time() - start) * 1000)

        logger.info(
            f"E2B 占位：执行代码（sandbox={sandbox_id}, exec={execution_id}, "
            f"exit={exit_code}, duration={duration_ms}ms）"
        )

        return SandboxRunCodeResponse(
            execution_id=execution_id,
            stdout=stdout,
            stderr=stderr,
            exit_code=exit_code,
            duration_ms=duration_ms,
            result=result,
        )

    async def kill_sandbox(self, sandbox_id: str) -> SandboxKillResponse:
        """销毁沙箱"""
        if sandbox_id in self._sandboxes:
            del self._sandboxes[sandbox_id]
            logger.info(f"E2B 占位：销毁沙箱 {sandbox_id}")
            return SandboxKillResponse(ok=True, message=f"沙箱 {sandbox_id} 已销毁")
        return SandboxKillResponse(ok=False, message=f"沙箱不存在：{sandbox_id}")

    def list_sandboxes(self) -> SandboxListResponse:
        """列出所有活跃沙箱"""
        sandboxes = []
        for sid, meta in self._sandboxes.items():
            sandboxes.append({
                "sandbox_id": sid,
                "template": meta["template"],
                "status": meta["status"],
                "created_at": meta["created_at"],
                "timeout": meta["timeout"],
            })
        return SandboxListResponse(sandboxes=sandboxes)


# ============================================================
# 单例
# ============================================================

_adapter: E2BAdapter | None = None


def get_e2b_adapter() -> E2BAdapter:
    global _adapter
    if _adapter is None:
        _adapter = E2BAdapter()
    return _adapter
