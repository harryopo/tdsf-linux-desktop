"""
OpenDerisk 适配器：SRE 根因诊断（v1.5 LLM 增强版）

OpenDerisk (derisk-ai) 介绍：
- GitHub: https://github.com/derisk-ai/OpenDerisk
- Apache-2.0 协议
- 蚂蚁集团生产 SRE Agent + 学术论文双背书
- V3: Multi-Specialist 模式（多 Agent 协同），76 个生产 SRE 案例

TDSF 集成策略（v1.5 升级）：
- v1.0：纯规则匹配（透明化推理链，0 网络依赖）
- v1.5：双阶段诊断
    阶段 1：规则匹配（baseline，7 条规则）
    阶段 2：LLM 增强（OpenAI 兼容 API，可选）
        - 接收：规则匹配结果 + 原始日志 + 服务名
        - 输出：深度根因分析、补充建议、关联风险
        - 超时：10s
- 降级：API Key 为空 / LLM 超时 / LLM 失败 → 自动回退到纯规则结果
- 未来升级：直接替换为 OpenDerisk 真实实现（保留接口签名）

LLM 配置来源（按优先级）：
1. 请求级 LlmConfig（每次调用可换模型）
2. 环境变量 TDSF_LLM_API_KEY / TDSF_LLM_BASE_URL / TDSF_LLM_MODEL
"""
import logging
import os
import re
import json
import time
from typing import List, Dict, Any, Optional

logger = logging.getLogger("open-derisk-adapter")


# ============================================================
# 根因规则库（v1.0 启发式 + v1.5 扩展）
# 设计参考：loghub 论文 + Google SRE Book
# ============================================================
ROOT_CAUSE_RULES = [
    {
        "pattern": r"(?i)connection\s+(refused|timeout|reset|failed)",
        "root_cause": "网络连接失败（数据库/上游服务不可达）",
        "severity": "high",
        "recommendations": [
            "检查目标服务（数据库/上游）健康状态：systemctl status <service>",
            "验证网络连通性：telnet <host> <port> 或 nc -zv <host> <port>",
            "查看防火墙规则：iptables -L -n 或 ufw status",
            "检查 DNS 解析：nslookup <hostname>",
        ],
        "confidence_base": 0.85,
    },
    {
        "pattern": r"(?i)(out\s+of\s+memory|oom|killed\s+process|cannot\s+allocate)",
        "root_cause": "内存不足（OOM Killer 触发或内存分配失败）",
        "severity": "critical",
        "recommendations": [
            "查看内存使用：free -h 或 cat /proc/meminfo",
            "检查 OOM 日志：dmesg | grep -i 'out of memory'",
            "分析进程内存：ps aux --sort=-%mem | head -10",
            "考虑扩容或优化内存使用（heap dump / 内存泄漏分析）",
        ],
        "confidence_base": 0.92,
    },
    {
        "pattern": r"(?i)(disk\s+(full|space\s+low)|no\s+space\s+left|enospc)",
        "root_cause": "磁盘空间不足",
        "severity": "high",
        "recommendations": [
            "查看磁盘使用：df -h",
            "查找大文件：du -sh /* | sort -h | tail -20",
            "清理日志：journalctl --vacuum-time=7d",
            "考虑扩容或归档旧数据",
        ],
        "confidence_base": 0.90,
    },
    {
        "pattern": r"(?i)(permission\s+denied|ep|eacces|access\s+denied)",
        "root_cause": "权限不足（文件/端口/资源访问被拒）",
        "severity": "medium",
        "recommendations": [
            "检查文件权限：ls -la <file>",
            "验证用户身份：whoami && id",
            "检查 SELinux：getenforce && ausearch -m avc",
            "检查文件所有者：chown -R <user>:<group> <path>",
        ],
        "confidence_base": 0.88,
    },
    {
        "pattern": r"(?i)(timeout|timed?\s*out|deadline\s+exceeded)",
        "root_cause": "操作超时（网络慢或下游响应慢）",
        "severity": "medium",
        "recommendations": [
            "检查网络延迟：ping <host> 或 mtr <host>",
            "查看慢查询：数据库 slow log / 应用 profiler",
            "考虑调整超时阈值或优化下游性能",
            "查看资源使用：top / iotop / iftop",
        ],
        "confidence_base": 0.78,
    },
    {
        "pattern": r"(?i)(segfault|sigsegv|core\s+dumped|stack\s+overflow)",
        "root_cause": "程序崩溃（段错误或栈溢出）",
        "severity": "critical",
        "recommendations": [
            "获取 core dump：ulimit -c unlimited && sysctl kernel.core_pattern",
            "用 gdb 分析：gdb <binary> <core>",
            "查看相关日志：journalctl -u <service> --since='-1h'",
            "考虑回滚到上一个稳定版本",
        ],
        "confidence_base": 0.93,
    },
    {
        "pattern": r"(?i)(cpu\s+(high|usage)|load\s+average|cpu\s+steal)",
        "root_cause": "CPU 使用率过高或负载高",
        "severity": "medium",
        "recommendations": [
            "查看 CPU 占用：top -c 或 htop",
            "分析 CPU 热点：perf top -p <pid>",
            "检查负载：uptime 或 w",
            "考虑扩容或限流",
        ],
        "confidence_base": 0.80,
    },
    # v1.5 新增：Docker/K8s 场景
    {
        "pattern": r"(?i)(container\s+(killed|oom)|pod\s+(evicted|crashloop)|imagepullbackoff)",
        "root_cause": "容器/Pod 异常（K8s 资源限制或镜像问题）",
        "severity": "high",
        "recommendations": [
            "查看 Pod 状态：kubectl describe pod <pod>",
            "检查资源限制：kubectl get pod <pod> -o yaml | grep -A 5 resources",
            "查看节点资源：kubectl top node",
            "检查事件：kubectl get events --sort-by=.lastTimestamp",
        ],
        "confidence_base": 0.87,
    },
    # v1.5 新增：数据库死锁
    {
        "pattern": r"(?i)(deadlock\s+detected|lock\s+wait\s+timeout|too\s+many\s+connections)",
        "root_cause": "数据库锁/连接问题（死锁或连接池耗尽）",
        "severity": "high",
        "recommendations": [
            "查看锁等待：MySQL: SHOW PROCESSLIST; PG: SELECT * FROM pg_stat_activity;",
            "分析死锁日志：MySQL: SHOW ENGINE INNODB STATUS;",
            "检查连接池配置：HikariCP / pgbouncer",
            "优化长事务：拆分大事务，添加合适索引",
        ],
        "confidence_base": 0.89,
    },
    # v1.5 新增：证书/SSL 问题
    {
        "pattern": r"(?i)(ssl|certificate|tls).*?(expired|invalid|handshake\s+failed|verify)",
        "root_cause": "SSL/TLS 证书问题（过期或不信任）",
        "severity": "high",
        "recommendations": [
            "检查证书有效期：openssl x509 -in <cert> -noout -dates",
            "验证证书链：openssl verify -CAfile <ca-bundle> <cert>",
            "检查系统时间：date && timedatectl status",
            "更新证书或续期（Let's Encrypt / 内部 CA）",
        ],
        "confidence_base": 0.86,
    },
]


# ============================================================
# LLM Prompt 模板（v1.5 新增）
# 设计：
# - System：定义 LLM 角色（SRE 专家）+ 输出格式（JSON Schema）
# - User：规则匹配结果 + 原始日志 + 服务名
# - 输出：JSON 格式（root_cause / severity / recommendations / confidence / related_risks）
# ============================================================
LLM_SYSTEM_PROMPT = """你是一位资深的 SRE（Site Reliability Engineering）专家，专注于 Linux 系统运维故障诊断。

任务：基于规则匹配结果和原始日志，进行深度根因分析，输出更精准的诊断。

要求：
1. **不能凭空捏造**：所有结论必须基于给定的日志证据
2. **结构化输出**：必须返回严格 JSON 格式
3. **语言**：使用中文（与 TDSF 项目其他文档一致）
4. **重点关注**：
   - 规则匹配结果是否合理（可能规则误判）
   - 多条规则同时命中时的优先级
   - 隐含的根因（规则未覆盖的复合故障）
   - 关联风险（可能引发的次生故障）
5. **置信度范围**：0.0 ~ 1.0，建议 0.7 ~ 0.95（不要给极端值）

输出 JSON Schema（严格遵守）：
{
  "root_cause": "更准确的根因描述（中文，1-2 句话）",
  "severity": "critical | high | medium | low",
  "confidence": 0.0-1.0,
  "recommendations": ["具体可执行的修复建议", ...至少 3 条],
  "related_risks": ["可能引发的次生故障", ...可空],
  "reasoning_summary": "一句话总结推理依据（中文）"
}

请直接返回 JSON，不要包含 markdown 代码块标记（如 ```json）。"""


def build_llm_user_prompt(
    rule_match_result: Dict[str, Any],
    log_templates: List[Dict[str, Any]],
    service_name: str,
    extra_context: Optional[Dict[str, Any]] = None,
) -> str:
    """构造 LLM User Prompt"""
    # 提取 top-3 模板（避免 prompt 过长）
    top_templates = sorted(log_templates, key=lambda t: t.get("count", 0), reverse=True)[:3]
    templates_text = "\n".join([
        f"- 模板 {i+1}（出现 {t.get('count', 0)} 次）: {t.get('template', '')}"
        for i, t in enumerate(top_templates)
    ])

    # 提取 example 样例（每个模板最多 1 个）
    examples_text = ""
    for i, t in enumerate(top_templates):
        examples = t.get("examples", [])
        if examples:
            examples_text += f"\n- 模板 {i+1} 原始样例: {examples[0][:200]}"

    context_text = ""
    if extra_context:
        context_text = f"\n\n**额外上下文**：\n{json.dumps(extra_context, ensure_ascii=False, indent=2)}"

    return f"""**服务名**：{service_name}

**规则匹配结果（基线诊断）**：
- 根因：{rule_match_result.get('root_cause', '未知')}
- 严重度：{rule_match_result.get('severity', 'unknown')}
- 规则置信度：{rule_match_result.get('confidence', 0):.2f}
- 规则推理：{rule_match_result.get('reasoning', [])}

**Top-{len(top_templates)} 高频日志模板**：
{templates_text}
{examples_text}
{context_text}

请基于以上信息，输出更精准的深度诊断（严格 JSON 格式）。"""


class OpenDeriskAdapter:
    """
    OpenDerisk 适配器（v1.5 双阶段诊断版）

    升级路径：
    - v1.0：纯规则匹配
    - v1.5：规则匹配 + LLM 增强（API Key 为空时降级）
    - v2.0：直接接入 OpenDerisk 真实实现
    """

    def __init__(self):
        self.rules = ROOT_CAUSE_RULES
        self._openai_client = None  # 延迟初始化（避免无 LLM config 时报错）
        self._llm_timeout = float(os.environ.get("TDSF_LLM_TIMEOUT", "10.0"))
        logger.info(
            f"OpenDerisk 适配器初始化完成（v1.5 双阶段诊断模式，"
            f"{len(self.rules)} 条规则，LLM 超时 {self._llm_timeout}s）"
        )

    def status(self) -> dict:
        """返回适配器状态（健康检查用）"""
        llm_available = self._resolve_llm_config(None) is not None
        return {
            "ready": True,
            "mode": "dual-stage-v1.5",
            "rules_count": len(self.rules),
            "llm_enabled": llm_available,
            "llm_timeout": self._llm_timeout,
        }

    # ============================================================
    # LLM Config 解析（请求级 > 环境变量）
    # ============================================================
    def _resolve_llm_config(self, request_config: Optional[Dict[str, Any]]) -> Optional[Dict[str, str]]:
        """
        解析 LLM 配置（按优先级：请求级 > 环境变量 > None）

        Returns:
            {"api_key": "...", "base_url": "...", "model": "..."} 或 None
        """
        api_key = None
        base_url = None
        model = None

        # 1. 请求级 config
        if request_config:
            api_key = request_config.get("apiKey") or request_config.get("api_key")
            base_url = request_config.get("baseUrl") or request_config.get("base_url")
            model = request_config.get("model")

        # 2. 环境变量 fallback
        api_key = api_key or os.environ.get("TDSF_LLM_API_KEY")
        base_url = base_url or os.environ.get("TDSF_LLM_BASE_URL")
        model = model or os.environ.get("TDSF_LLM_MODEL")

        if not (api_key and base_url and model):
            return None
        return {"api_key": api_key, "base_url": base_url, "model": model}

    def _get_openai_client(self, config: Dict[str, str]):
        """获取 OpenAI 客户端（延迟初始化 + 单例）"""
        if self._openai_client is None:
            try:
                from openai import OpenAI
                self._openai_client = OpenAI(
                    api_key=config["api_key"],
                    base_url=config["base_url"],
                    timeout=self._llm_timeout,
                )
            except ImportError:
                logger.error("openai 包未安装，请运行: pip install openai==1.59.9")
                return None
        return self._openai_client

    # ============================================================
    # LLM 增强诊断（v1.5 核心新增）
    # ============================================================
    def _call_llm_enhance(
        self,
        rule_match_result: Dict[str, Any],
        log_templates: List[Dict[str, Any]],
        service_name: str,
        llm_config: Dict[str, str],
        extra_context: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        调用 LLM 增强诊断（OpenAI 兼容 API）

        Returns:
            增强后的诊断结果 dict，或 None（失败时）
        """
        client = self._get_openai_client(llm_config)
        if client is None:
            return None

        user_prompt = build_llm_user_prompt(
            rule_match_result, log_templates, service_name, extra_context
        )

        start_time = time.time()
        try:
            response = client.chat.completions.create(
                model=llm_config["model"],
                messages=[
                    {"role": "system", "content": LLM_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.3,  # 低温度保证稳定性
                max_tokens=800,
                response_format={"type": "json_object"},  # 强制 JSON 输出
            )
            elapsed = time.time() - start_time

            # 提取响应
            content = response.choices[0].message.content
            if not content:
                logger.warning("LLM 返回空内容")
                return None

            # 解析 JSON
            try:
                llm_result = json.loads(content)
            except json.JSONDecodeError as e:
                logger.error(f"LLM 返回非 JSON：{content[:200]}, error={e}")
                return None

            logger.info(
                f"LLM 增强诊断完成（{elapsed:.2f}s, model={llm_config['model']}, "
                f"tokens={response.usage.total_tokens if response.usage else 'N/A'}）"
            )
            return llm_result

        except Exception as e:
            elapsed = time.time() - start_time
            logger.warning(f"LLM 调用失败（{elapsed:.2f}s）：{type(e).__name__}: {e}")
            return None

    def _merge_llm_result(
        self,
        rule_result: Dict[str, Any],
        llm_result: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        融合规则结果 + LLM 结果

        策略：
        - root_cause：采用 LLM（更精准）
        - confidence：取规则和 LLM 的平均（更稳健）
        - severity：取 LLM（更精细）
        - recommendations：合并去重（LLM 优先）
        - reasoning：拼接两条推理链
        """
        # 置信度融合（算术平均）
        rule_conf = rule_result.get("confidence", 0.5)
        llm_conf = llm_result.get("confidence", 0.5)
        merged_conf = round((rule_conf + llm_conf) / 2, 2)

        # 推荐合并（去重，保留顺序：LLM 优先 + 规则补充）
        seen = set()
        merged_recs = []
        for rec in llm_result.get("recommendations", []) + rule_result.get("recommendations", []):
            rec_clean = rec.strip()
            if rec_clean and rec_clean not in seen:
                seen.add(rec_clean)
                merged_recs.append(rec_clean)

        # 推理链拼接
        merged_reasoning = rule_result.get("reasoning", []) + [
            f"LLM 推理：{llm_result.get('reasoning_summary', '无')}",
        ]

        return {
            "root_cause": llm_result.get("root_cause", rule_result.get("root_cause", "未知")),
            "confidence": merged_conf,
            "severity": llm_result.get("severity", rule_result.get("severity", "low")),
            "recommendations": merged_recs,
            "related_risks": llm_result.get("related_risks", []),
            "reasoning": merged_reasoning,
            "source": "open-derisk-llm-enhanced",
            "rule_confidence": rule_conf,
            "llm_confidence": llm_conf,
        }

    # ============================================================
    # 主诊断方法（升级 v1.0 → v1.5）
    # ============================================================
    def diagnose(
        self,
        log_templates: List[Dict[str, Any]],
        service_name: str = "unknown",
        extra_context: Dict[str, Any] = None,
        llm_config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        SRE 根因诊断（v1.5 双阶段）

        Args:
            log_templates: Drain3 输出的模板列表
            service_name: 服务名
            extra_context: 额外上下文（metrics / traces 等）
            llm_config: LLM 配置 {"apiKey": "...", "baseUrl": "...", "model": "..."}（可选）

        Returns:
            诊断结果 dict
        """
        if extra_context is None:
            extra_context = {}

        # ===== 阶段 1：规则匹配（baseline） =====
        rule_result = self._rule_match(log_templates, service_name, extra_context)

        # ===== 阶段 2：LLM 增强（可选） =====
        resolved_llm_config = self._resolve_llm_config(llm_config)
        if resolved_llm_config:
            logger.info(f"启用 LLM 增强（model={resolved_llm_config['model']}）")
            llm_result = self._call_llm_enhance(
                rule_result, log_templates, service_name, resolved_llm_config, extra_context
            )
            if llm_result:
                # 融合
                merged = self._merge_llm_result(rule_result, llm_result)
                return merged
            else:
                # LLM 失败 → 降级到纯规则
                rule_result["source"] = "rule-based-llm-failed"
                rule_result.setdefault("reasoning", []).append("LLM 调用失败，降级到纯规则匹配")
                return rule_result
        else:
            # 无 LLM config → 纯规则
            rule_result["source"] = "rule-based"
            return rule_result

    def _rule_match(
        self,
        log_templates: List[Dict[str, Any]],
        service_name: str,
        extra_context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        规则匹配（v1.0 核心逻辑，v1.5 抽离为私有方法）
        """
        # 按 count 加权聚合（高频模板优先）
        all_templates_text = []
        for t in log_templates:
            template = t.get("template", "")
            count = t.get("count", 1)
            all_templates_text.extend([template] * min(count, 10))

        all_text = "\n".join(all_templates_text)

        # 规则匹配打分
        matches = []
        for rule in self.rules:
            regex_matches = re.findall(rule["pattern"], all_text)
            if regex_matches:
                score = len(regex_matches) * rule["confidence_base"]
                matches.append({
                    "rule": rule,
                    "score": score,
                    "match_count": len(regex_matches),
                })

        matches.sort(key=lambda m: m["score"], reverse=True)

        if not matches:
            return {
                "root_cause": f"无法识别根因（{len(log_templates)} 个模板无匹配规则）",
                "confidence": 0.30,
                "severity": "low",
                "recommendations": [
                    "人工分析日志模板",
                    "扩展根因规则库（提交 issue 到 TDSF 仓库）",
                ],
                "reasoning": [
                    f"输入：{len(log_templates)} 个日志模板（服务={service_name}）",
                    f"规则匹配：0/{len(self.rules)} 条命中",
                    "降级处理：建议人工分析",
                ],
                "source": "rule-fallback",
            }

        best = matches[0]
        confidence = min(
            best["rule"]["confidence_base"] + min(best["match_count"], 5) * 0.02,
            0.98,
        )

        reasoning = [
            f"输入：{len(log_templates)} 个日志模板（服务={service_name}）",
            f"规则匹配：{best['match_count']} 次命中 {best['rule']['root_cause'][:30]}",
            f"基础置信度：{best['rule']['confidence_base']:.2f} + 匹配加成 {min(best['match_count'], 5) * 0.02:.2f}",
            f"最终置信度：{confidence:.2f}",
        ]

        return {
            "root_cause": best["rule"]["root_cause"],
            "confidence": round(confidence, 2),
            "severity": best["rule"]["severity"],
            "recommendations": best["rule"]["recommendations"],
            "reasoning": reasoning,
            "source": "rule-based",
        }
