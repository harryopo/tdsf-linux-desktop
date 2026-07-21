"""诊断脚本：用 Python sqlite3 检查数据库完整性（避免 better-sqlite3 ABI 问题）"""
import os
import sys
import sqlite3
from pathlib import Path

# Electron userData 路径
user_data_dir = Path(os.path.expanduser('~')) / 'AppData' / 'Roaming' / 'tdsf-linux-desktop'
db_path = user_data_dir / 'tdsf.db'

print(f'[diag] Python: {sys.version.split()[0]}')
print(f'[diag] dbPath: {db_path}')
print(f'[diag] dbPath exists: {db_path.exists()}')

if db_path.exists():
    stat = db_path.stat()
    print(f'[diag] db size: {stat.st_size / 1024:.1f} KB')
    import datetime
    mtime = datetime.datetime.fromtimestamp(stat.st_mtime)
    print(f'[diag] db mtime: {mtime.isoformat()}')

# 列出所有 .db 文件
print('\n[diag] 相关文件:')
if user_data_dir.exists():
    for f in user_data_dir.iterdir():
        if 'tdsf' in f.name:
            s = f.stat()
            mtime = datetime.datetime.fromtimestamp(s.st_mtime)
            print(f'  {f.name}: {s.st_size / 1024:.1f} KB ({mtime.isoformat()})')

# 用 Python sqlite3 打开
print('\n[diag] 打开数据库:')
try:
    # 先 checkpoint WAL（强制把 WAL 内容写入主数据库文件）
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    cursor.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    checkpoint_result = cursor.fetchone()
    print(f'[diag] wal_checkpoint: {checkpoint_result}')

    # integrity_check
    print('[diag] integrity_check:')
    cursor.execute('PRAGMA integrity_check')
    for row in cursor.fetchall():
        print(f'  {row[0]}')

    # 表列表
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    tables = cursor.fetchall()
    print(f'\n[diag] 表数量: {len(tables)}')
    print('[diag] 表列表:')
    for t in tables:
        print(f'  {t[0]}')

    # knowledge_entries 统计
    try:
        cursor.execute("SELECT COUNT(*) FROM knowledge_entries WHERE type='tutorial'")
        total = cursor.fetchone()[0]
        print(f'\n[diag] tutorial 总数: {total}')

        cursor.execute("SELECT COUNT(*) FROM knowledge_entries WHERE type='tutorial' AND embedding IS NULL")
        pending = cursor.fetchone()[0]
        print(f'[diag] 待回填 embedding: {pending}')

        cursor.execute("SELECT COUNT(*) FROM knowledge_entries WHERE type='tutorial' AND embedding IS NOT NULL")
        has_emb = cursor.fetchone()[0]
        print(f'[diag] 已有 embedding: {has_emb}')

        # 样本
        cursor.execute("SELECT id, title, length(embedding) FROM knowledge_entries WHERE type='tutorial' LIMIT 3")
        print('\n[diag] 样本:')
        for row in cursor.fetchall():
            print(f'  id={row[0]}, title="{row[1]}", emb_len={row[2]}')

        # 看看 type 分布
        cursor.execute("SELECT type, COUNT(*) FROM knowledge_entries GROUP BY type")
        print('\n[diag] type 分布:')
        for row in cursor.fetchall():
            print(f'  type={row[0]}: {row[1]} 条')

    except Exception as e:
        print(f'[diag] 查询失败: {e}')

    conn.close()
except Exception as e:
    print(f'[diag] 打开失败: {e}')
