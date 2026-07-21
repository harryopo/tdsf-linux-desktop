# Sidecar-A：SRE + 日志解析（v1.0 核心 MVP）

> **版本**：v1.0.0
> **承接文档**：[37-工业级方案全量集成路线图.md](../../../idea-to-dev-output/37-工业级方案全量集成路线图.md) Week 1
> **作者**：TDSF 开发组
> **定位**：v1.0 战略升级第一个落地的 sidecar

## 一、定位

**跑通 1 条端到端链路**：日志输入 → Drain3 解析 → OpenDerisk 诊断 → JSON 回传

| 维度 | 数值 |
|---|---|
| 端口 | 7931（localhost 监听）|
| 通信 | HTTP（FastAPI），不用 stdio JSON-RPC（开发快 3 倍）|
| 依赖 | fastapi + uvicorn + drain3 + pydantic |
| 体积 | ~10 MB（venv 内）|
| 启动 | <1s（FastAPI）|
| 集成 | 仅 SidecarManager 一个 TS 文件 |
| 打包 | v1.0 阶段不打包（直接 venv 运行）|

## 二、3 个端点

| 端点 | 方法 | 作用 |
|---|---|---|
| `/health` | GET | 健康检查 |
| `/drain3/parse` | POST | 日志模板解析 |
| `/sre/diagnose` | POST | SRE 根因诊断 |
| `/pipeline/run` | POST | 一站式：日志 → Drain3 → OpenDerisk |

## 三、启动方式

```bash
# 1. 创建 venv
cd d:\ai\linux教学一体\tdsf-linux-desktop
python -m venv .venv-sidecar-a

# 2. 激活 venv
# Windows PowerShell
.\.venv-sidecar-a\Scripts\Activate.ps1
# Windows CMD
.\.venv-sidecar-a\Scripts\activate.bat
# Git Bash
source .venv-sidecar-a/Scripts/activate

# 3. 安装依赖
pip install -r sidecar-a/requirements.txt

# 4. 启动
python -m sidecar-a.main
# 或
uvicorn sidecar-a.main:app --host 127.0.0.1 --port 7931
```

## 四、测试

```bash
# 健康检查
curl http://127.0.0.1:7931/health

# 端到端
curl -X POST http://127.0.0.1:7931/pipeline/run \
  -H "Content-Type: application/json" \
  -d '{
    "service_name": "nginx",
    "log_lines": [
      "2026-07-20 10:00:00 ERROR Connection refused to db:5432",
      "2026-07-20 10:00:01 ERROR Connection refused to db:5432",
      "2026-07-20 10:00:02 ERROR Connection timeout to upstream"
    ]
  }'
```

## 五、OpenDerisk v1.0 简化策略

**真实 OpenDerisk**（蚂蚁生产 SRE Agent）依赖：
- Docker + 大模型（Qwen / GPT-4）
- 完整 MCP 生态
- 76 个生产 SRE 案例训练

**v1.0 简化版**（保留接口签名）：
- 用 ROOT_CAUSE_RULES 规则匹配（7 类常见根因）
- 透明化推理链（reasoning 数组）
- v1.5 升级到真实 OpenDerisk（保留 diagnose() 接口）

## 六、Lessons

1. **MVP 优先于完美**：v1.0 跑通 1 条端到端链路 > 集成 10 个半成品
2. **localhost HTTP > stdio JSON-RPC**：开发速度快 3 倍，调试更简单
3. **不打包 = 节省 90% 集成时间**：venv 直接跑，省去 PyInstaller 配置
4. **保留接口签名 = 无缝升级**：v1.0 mock 适配器与 v1.5 真实 OpenDerisk 共享同一 API
5. **透明化推理链**：每条诊断都返回 reasoning[]，用户能理解 WHY
