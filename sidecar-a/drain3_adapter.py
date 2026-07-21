"""
drain3 适配器：日志模板解析（v1.5 FilePersistence 版）

v1.5 升级（v1.0 → v1.5）：
- 新增 FilePersistence 支持：进程重启后 cluster state 自动恢复
- 持久化文件路径：sidecar-a/.drain3_state.bin
- 避免每次启动丢失历史模板（提升日志分析的连续性）

设计参考：
- Drain3 FilePersistence：https://github.com/logpai/Drain3/blob/master/drain3/persistence.py
- 应用场景：长时间运行服务（日志模板跨重启累计）
"""
import logging
import os
import time
from typing import List, Dict, Any
from drain3 import TemplateMiner
from drain3.file_persistence import FilePersistence
from drain3.template_miner_config import TemplateMinerConfig

logger = logging.getLogger("drain3-adapter")

# ============================================================
# Drain3 配置文件（v1.5 沿用 v1.0 配置）
# ============================================================
DRAIN3_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "drain3_config.ini")

# ============================================================
# 持久化文件路径（v1.5 新增）
# ============================================================
PERSISTENCE_PATH = os.path.join(os.path.dirname(__file__), ".drain3_state.bin")


class Drain3Adapter:
    """
    Drain3 适配器（v1.5 FilePersistence 升级版）

    升级路径：
    - v1.0：纯内存 TemplateMiner（进程重启即丢失 cluster state）
    - v1.5：FilePersistence 持久化（cluster state 跨重启保留）

    兼容性：
    - drain3 0.9.11：FilePersistence 通过 state_filepath 参数传入
    - 持久化文件：二进制格式（drain3 内部序列化）
    """

    def __init__(self):
        # 1. 加载 Drain3 配置
        if not os.path.exists(DRAIN3_CONFIG_PATH):
            raise FileNotFoundError(f"Drain3 config not found: {DRAIN3_CONFIG_PATH}")
        config = TemplateMinerConfig()
        config.load(DRAIN3_CONFIG_PATH)
        config.profiling_enabled = False  # 关闭 profiling 减少开销

        # 2. 初始化 FilePersistence（v1.5 新增）
        # 关键：FilePersistence 在 TemplateMiner 之前创建
        # 用途：cluster state 持久化到磁盘
        # 注意：drain3 0.9.11 的参数名是 file_path（不是 state_filepath）
        persistence = FilePersistence(file_path=PERSISTENCE_PATH)

        # 3. 初始化 TemplateMiner（带持久化）
        # 注意：drain3 0.9.11 的参数名是 persistence_handler（不是 persistence）
        self.template_miner = TemplateMiner(
            persistence_handler=persistence,
            config=config,
        )

        # 4. 客户端 examples 缓存（v1.0 沿用，drain3 0.9.11 cluster 无 sample_log）
        self._examples: Dict[str, List[str]] = {}
        self._max_examples = 3  # 每个 cluster 最多保留 3 个原始样例

        cluster_count = (
            len(self.template_miner.drain.clusters)
            if hasattr(self.template_miner, "drain")
            else 0
        )
        logger.info(
            f"Drain3 适配器初始化完成（v1.5 FilePersistence 模式，"
            f"已恢复 {cluster_count} 个历史 cluster，持久化文件 {PERSISTENCE_PATH}）"
        )

    def status(self) -> dict:
        """返回适配器状态（健康检查用）"""
        cluster_count = (
            len(self.template_miner.drain.clusters)
            if hasattr(self.template_miner, "drain")
            else 0
        )
        return {
            "ready": True,
            "total_clusters": cluster_count,
            "persistence_enabled": True,
            "persistence_path": PERSISTENCE_PATH,
        }

    def parse(
        self,
        log_lines: List[str],
        max_clusters: int = 50,
    ) -> Dict[str, Any]:
        """
        解析日志 → 提取模板

        Args:
            log_lines: 原始日志行列表
            max_clusters: 最大模板数（截断）

        Returns:
            {
                "templates": [{template_id, template, count, examples}, ...],
                "total_lines": int,
                "unique_templates": int,
            }
        """
        if not log_lines:
            return {"templates": [], "total_lines": 0, "unique_templates": 0}

        start_time = time.time()
        templates_map: Dict[str, Dict[str, Any]] = {}  # cluster_id -> {template, count, examples}
        total_lines = len(log_lines)

        for line in log_lines:
            try:
                result = self.template_miner.add_log_message(line)
                cluster = result["cluster_id"]
                template = result["template_mined"]

                if cluster not in templates_map:
                    templates_map[cluster] = {
                        "template_id": str(cluster),
                        "template": template,
                        "count": 0,
                        "examples": [],
                    }

                templates_map[cluster]["count"] += 1
                if len(templates_map[cluster]["examples"]) < self._max_examples:
                    templates_map[cluster]["examples"].append(line[:200])  # 截断长行
            except Exception as e:
                logger.warning(f"Drain3 解析单行失败：{e}（line={line[:80]}）")
                continue

        # 按 count 降序排序 + 截断 max_clusters
        templates = sorted(
            templates_map.values(), key=lambda t: t["count"], reverse=True
        )[:max_clusters]

        elapsed = time.time() - start_time
        logger.info(
            f"Drain3 解析完成：{total_lines} 行 → {len(templates_map)} 个模板"
            f"（{elapsed * 1000:.0f} ms，返回 top {len(templates)}）"
        )

        return {
            "templates": templates,
            "total_lines": total_lines,
            "unique_templates": len(templates_map),
        }
