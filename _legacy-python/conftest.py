"""pytest 配置文件。

确保 src 目录在 sys.path 中，方便测试导入 tdsf_desktop 模块。
"""
from __future__ import annotations

import sys
from pathlib import Path

# 将 src 目录添加到 sys.path
_SRC_DIR = str(Path(__file__).resolve().parent.parent / "src")
if _SRC_DIR not in sys.path:
    sys.path.insert(0, _SRC_DIR)
