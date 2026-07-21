#!/usr/bin/env python3
"""
Drain3 日志模板提取桥接脚本

通过 stdin 接收 JSON 请求，通过 stdout 返回 JSON 响应。
请求格式：{"id": 1, "lines": ["log line 1", "log line 2", ...]}
响应格式：{"id": 1, "result": [{"templateId": "E1", "template": "log <*>", "count": 5}]}

依赖：drain3 (pip install drain3)
若未安装 drain3，则降级到内置正则模板提取。
"""
import argparse
import json
import re
import sys
from typing import List, Dict, Any

# 尝试导入 drain3
try:
    from drain3 import TemplateMiner
    from drain3.template_miner_config import TemplateMinerConfig
    DRAIN3_AVAILABLE = True
except ImportError:
    DRAIN3_AVAILABLE = False
    TemplateMiner = None
    TemplateMinerConfig = None


class Drain3Bridge:
    """Drain3 模板提取桥接（带降级）"""

    def __init__(self, similarity_threshold: float = 0.5, max_children: int = 100):
        self.similarity_threshold = similarity_threshold
        self.max_children = max_children
        self.miner = None
        if DRAIN3_AVAILABLE:
            try:
                config = TemplateMinerConfig()
                config.similarity_threshold = similarity_threshold
                config.max_children = max_children
                self.miner = TemplateMiner(config=config)
            except Exception as e:
                print(f"[Drain3] 初始化失败: {e}", file=sys.stderr)
                self.miner = None

    def extract(self, log_lines: List[str]) -> List[Dict[str, Any]]:
        """
        提取日志模板
        :param log_lines: 日志行列表
        :return: 模板列表 [{"templateId", "template", "count"}]
        """
        if self.miner is not None:
            return self._extract_with_drain3(log_lines)
        return self._fallback_extract(log_lines)

    def _extract_with_drain3(self, log_lines: List[str]) -> List[Dict[str, Any]]:
        """使用 Drain3 提取"""
        result: List[Dict[str, Any]] = []
        seen: Dict[str, int] = {}
        for line in log_lines:
            try:
                result_drain = self.miner.add_log_message(line)
                template = result_drain.get("template_mined", "")
                cluster_id = result_drain.get("cluster_id", "")
                if template:
                    if template in seen:
                        seen[template] += 1
                    else:
                        seen[template] = 1
                        result.append({
                            "templateId": f"D{cluster_id}",
                            "template": template,
                            "count": 1
                        })
            except Exception as e:
                # Drain3 解析失败时降级
                print(f"[Drain3] 解析失败: {e}", file=sys.stderr)
                return self._fallback_extract(log_lines)

        # 排序并更新 count
        result_sorted = sorted(
            [
                {"templateId": t["templateId"], "template": t["template"], "count": seen[t["template"]]}
                for t in result
            ],
            key=lambda x: -x["count"]
        )
        return result_sorted

    def _fallback_extract(self, log_lines: List[str]) -> List[Dict[str, Any]]:
        """
        降级方案：使用正则提取常见模式
        - 时间戳 → <*>
        - 数字 → <*>
        - IP → <*>
        - UUID → <*>
        """
        template_count: Dict[str, int] = {}
        for line in log_lines:
            template = (
                line
                .replace('\r', '')
                .replace('\n', '')
                .strip()
            )
            # 替换 IP
            template = re.sub(r'\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}', '<IP>', template)
            # 替换 UUID
            template = re.sub(
                r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
                '<UUID>',
                template,
                flags=re.IGNORECASE
            )
            # 替换 ISO 时间戳
            template = re.sub(
                r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?',
                '<TIMESTAMP>',
                template
            )
            # 替换数字
            template = re.sub(r'\b\d+\b', '<NUM>', template)
            # 替换十六进制
            template = re.sub(r'0x[0-9a-fA-F]+', '<HEX>', template)
            # 替换路径
            template = re.sub(r'/[\w./-]+', '<PATH>', template)

            template_count[template] = template_count.get(template, 0) + 1

        # 按 count 降序排序
        sorted_templates = sorted(
            template_count.items(),
            key=lambda x: -x[1]
        )
        return [
            {"templateId": f"F{i}", "template": t, "count": c}
            for i, (t, c) in enumerate(sorted_templates)
        ]


def main():
    """主循环：读取 stdin JSON 请求，返回 stdout JSON 响应"""
    parser = argparse.ArgumentParser(description="Drain3 日志模板提取桥接")
    parser.add_argument("--similarity", type=float, default=0.5, help="相似度阈值")
    parser.add_argument("--max-children", type=int, default=100, help="最大子节点数")
    args = parser.parse_args()

    bridge = Drain3Bridge(
        similarity_threshold=args.similarity,
        max_children=args.max_children
    )

    if DRAIN3_AVAILABLE and bridge.miner is not None:
        print("[Drain3] 启动成功，使用 Drain3 引擎", file=sys.stderr)
    else:
        print("[Drain3] 未安装 drain3，使用本地正则降级方案", file=sys.stderr)

    print("READY", flush=True)

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            request_id = request.get("id", 0)
            log_lines = request.get("lines", [])
            if not isinstance(log_lines, list):
                raise ValueError("lines 必须是数组")
            templates = bridge.extract(log_lines)
            response = {"id": request_id, "result": templates}
        except json.JSONDecodeError as e:
            response = {"id": 0, "error": f"JSON 解析失败: {e}"}
        except Exception as e:
            response = {"id": 0, "error": f"处理失败: {e}"}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
