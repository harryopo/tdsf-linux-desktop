# OpenHands list sandboxes 端点 session_api_key 行为调研

> 调研日期：2026-07-18
> 调研目的：确认主进程重启后能否通过 list/search 端点恢复 sessionKeyMap 缓存
> 调研结论：**方案 A（预热缓存）可行且推荐**

---

## 一、本地代码分析结论

### 1.1 listSandboxes 实际实现：`searchSandboxes`

文件：`src/main/services/sandbox/openhands-client.ts:205-209`

本地代码没有 `listSandboxes` 方法，实际方法名是 `searchSandboxes`，对应 OpenHands 后端路由 `GET /sandboxes/search`：

```ts
async searchSandboxes(limit: number = 100): Promise<SandboxPage> {
  const url = new URL('/sandboxes/search', this.baseUrl)
  url.searchParams.set('limit', String(limit))
  return await this.request<SandboxPage>('GET', url)
}
```

响应解析特点：
- 直接反序列化为 `SandboxPage`，**无字段过滤、无字段重命名**
- 保留 snake_case 命名，与后端 Pydantic 模型一一对应
- 即：后端响应中有什么字段，前端就能拿到什么字段

### 1.2 SandboxInfo 类型定义

文件：`src/main/services/sandbox/types.ts:61-81`

```ts
export interface SandboxInfo {
  id: string
  created_by_user_id: string | null
  sandbox_spec_id: string
  status: SandboxStatus
  session_api_key: string | null   // ← 必填字段，值可为 null
  exposed_urls: ExposedUrl[] | null
  created_at: string
}
```

关键点：
- `session_api_key` 是**必填字段**（类型 `string | null`，不是 `?` 可选）
- 注释明确：「STARTING / PAUSED 状态下为 null，需 wait_for_sandbox_running 后再取」
- 本地类型定义与 OpenHands 后端 `sandbox_models.py#SandboxInfo` 完全一致

### 1.3 本地代码结论

本地客户端**已具备解析 search 响应中 session_api_key 的能力**，无需修改类型或解析逻辑。只要后端在 RUNNING 状态返回该字段，前端就能拿到。

---

## 二、OpenHands API 官方行为调研结论

### 2.1 SandboxInfo Pydantic 模型（权威源码）

源文件：`openhands/app_server/sandbox/sandbox_models.py`

```python
class SandboxInfo(BaseModel):
    """Information about a sandbox."""
    id: str
    created_by_user_id: str | None
    sandbox_spec_id: str
    status: SandboxStatus
    session_api_key: str | None = Field(
        description=(
            'Key to access sandbox, to be added as an `X-Session-API-Key` header '
            'in each request. In cases where the sandbox statues is STARTING or '
            'PAUSED, or the current user does not have full access '
            'the session_api_key will be None.'
        )
    )
    exposed_urls: list[ExposedUrl] | None = Field(...)
    created_at: datetime = Field(default_factory=utc_now)
```

字段语义：`session_api_key` 在 **STARTING / PAUSED / 无 full access** 时为 None；**RUNNING + 有 full access** 时返回明文 key。

### 2.2 DockerSandboxService 实现（本地 Docker 模式，默认场景）

源文件：`openhands/app_server/sandbox/docker_sandbox_service.py`

关键链路：`search_sandboxes` → `_container_to_checked_sandbox_info` → `_container_to_sandbox_info`

`_container_to_sandbox_info` 方法（第 121-200 行）揭示了 session_api_key 的真实来源：

```python
async def _container_to_sandbox_info(self, container) -> SandboxInfo | None:
    status = self._docker_status_to_sandbox_status(container.status)
    exposed_urls = None
    session_api_key = None
    if status == SandboxStatus.RUNNING:
        # Get session API key first
        env = self._get_container_env_vars(container)
        session_api_key = env.get(SESSION_API_KEY_VARIABLE)  # OH_SESSION_API_KEYS_0
        ...
    return SandboxInfo(
        ...
        session_api_key=session_api_key,
        ...
    )
```

**关键发现**：
1. `session_api_key` 不是 create 时一次性返回的随机值，而是**存储在 Docker 容器的环境变量 `OH_SESSION_API_KEYS_0` 中**
2. 每次 `search_sandboxes` / `get_sandbox` 调用都会**实时从容器 env 重新读取**该值
3. 只要 Docker 容器还在运行，多次调用 list/get 都会返回**相同的** session_api_key
4. `_container_to_checked_sandbox_info` 仅在健康检查失败（STARTING/ERROR）时才把 `session_api_key` 置为 None（第 245 行）

**App Server 重启场景**：
- Docker 容器是独立进程，App Server 重启不会影响容器
- App Server 重启后调用 `search_sandboxes`，仍能从 Docker 容器 env 读出 session_api_key
- ✅ **list 响应会包含 session_api_key（RUNNING 状态）**

### 2.3 RemoteSandboxService 实现（远程模式，补充验证）

源文件：`openhands/app_server/sandbox/remote_sandbox_service.py`

- DB 表 `StoredRemoteSandbox` 只存储 `session_api_key_hash`（SHA-256 哈希），**不存明文**
- `search_sandboxes`（第 268-305 行）流程：
  1. 从 DB 查 `StoredRemoteSandbox` 列表
  2. 调用 `_get_runtimes_batch(sandbox_ids)` 批量从 runtime API 获取运行时数据
  3. `_to_sandbox_info(stored, runtime)` 中：`session_api_key = runtime['session_api_key']`（第 143 行）

**关键发现**：
- 远程模式下 session_api_key 由 runtime API 实时返回
- 只要 runtime API 可达且沙箱在运行，search 响应就会包含明文 session_api_key
- ✅ **list 响应会包含 session_api_key（RUNNING 状态 + runtime 可达）**

### 2.4 官方行为总结

| 场景 | list/search 是否返回 session_api_key |
|------|------------------------------------|
| Docker 模式 + 沙箱 RUNNING | ✅ 返回明文（从容器 env 读取） |
| Docker 模式 + 沙箱 STARTING/PAUSED | ❌ 返回 null |
| Docker 模式 + 健康检查失败 | ❌ 返回 null（强制置 None） |
| Remote 模式 + 沙箱 RUNNING + runtime 可达 | ✅ 返回明文（runtime API 返回） |
| Remote 模式 + runtime API 不可达 | ❌ 返回 null（异常降级） |
| App Server 重启后 + Docker 容器仍在 | ✅ 仍能返回（容器 env 是持久化的） |

---

## 三、推荐的恢复方案

### 3.1 方案对比

| 方案 | 可行性 | 复杂度 | 安全性 | 用户体验 |
|------|--------|--------|--------|----------|
| **A. 预热缓存** | ✅ 高（官方行为支持） | 低 | 高（不落盘） | 无感恢复 |
| B. 强制重建 | ✅ 兜底 | 中 | 高 | 差（丢失沙箱） |
| C. 持久化 SecureStore | ⚠️ 可行但多余 | 高 | 中（明文落盘） | 无感恢复 |

### 3.2 推荐方案：A（预热缓存）为主 + B（强制重建）兜底

**核心结论**：session_api_key 在 RUNNING 状态下可从 list/search 响应中恢复，**方案 A 可行且最优**。

**推荐实施流程**：

1. **主进程启动时**（OpenHandsRunner.waitForReady 成功后）：
   - 调用 `defaultOpenHandsClient.searchSandboxes(100)`
   - 遍历 `SandboxPage.items`
   - 对每个 `status === 'RUNNING'` 且 `session_api_key` 非空的沙箱：
     - 填入 `sessionKeyMap.set(sandbox.id, sandbox.session_api_key)`
   - 日志记录：恢复了 N 个沙箱的 session key

2. **容错处理**：
   - 如果 search 调用失败（网络错误 / App Server 未就绪）：跳过预热，不阻塞启动
   - 如果某个沙箱 `session_api_key` 为 null（STARTING/PAUSED）：跳过该沙箱
   - 如果用户尝试操作一个 sessionKeyMap 中没有的沙箱：提示用户该沙箱需重新创建（方案 B 兜底）

3. **不采纳方案 C 的理由**：
   - session_api_key 可从运行时恢复，无需持久化
   - 明文 key 落盘到 SecureStore 增加攻击面
   - 即使持久化了 key，如果 App Server 没启动也无法使用沙箱（exposed_urls 也需要实时获取）
   - 增加复杂度无收益

### 3.3 实施注意事项

- 预热应在 OpenHands App Server 健康检查通过后执行（避免连接失败）
- 预热失败不应阻塞主进程启动（降级为「按需 getSandbox」）
- 对 STARTING 状态的沙箱，可考虑轮询 `getSandbox` 直到 RUNNING 后再填入缓存
- 分页处理：如果沙箱数量 > 100，需循环调用 searchSandboxes 并传入 next_page_id

---

## 四、调研证据溯源

| 证据 | 源文件 / URL |
|------|-------------|
| 本地 listSandboxes 实现 | `tdsf-linux-desktop/src/main/services/sandbox/openhands-client.ts:205-209` |
| 本地 SandboxInfo 类型 | `tdsf-linux-desktop/src/main/services/sandbox/types.ts:61-81` |
| SandboxInfo Pydantic 模型 | `openhands/app_server/sandbox/sandbox_models.py` (GitHub main) |
| DockerSandboxService 实现 | `openhands/app_server/sandbox/docker_sandbox_service.py` (GitHub main) |
| RemoteSandboxService 实现 | `openhands/app_server/sandbox/remote_sandbox_service.py` (GitHub main) |
| V1 API 官方文档 | https://docs.openhands.dev/openhands/usage/api/v1 |
| App Server 架构 | https://deepwiki.com/OpenHands/OpenHands/7-runtime-execution |
