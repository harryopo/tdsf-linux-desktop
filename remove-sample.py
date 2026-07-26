import os
import sys

file_path = r'd:\ai\linux教学一体\tdsf-linux-desktop\src\renderer\src\components\monitor\Charts.tsx'

# 尝试 GBK 编码读取
for enc in ['utf-8', 'gbk', 'gb2312', 'utf-8-sig']:
    try:
        with open(file_path, 'r', encoding=enc) as f:
            content = f.read()
        print(f'Read with {enc}, {len(content)} chars')
        # 直接查找 sample 数据解析 和 实时数据格式化
        start_idx = content.find('sample 数据解析')
        end_idx = content.find('实时数据格式化')
        print(f'start_idx={start_idx}, end_idx={end_idx}')
        if start_idx >= 0 and end_idx > start_idx:
            # 找到起点行（从开头到 start_idx 之前的换行）
            line_start = content.rfind('\n', 0, start_idx) + 1
            # 找到终点行
            line_end = content.find('\n', end_idx) + 1
            new_content = content[:line_start] + content[line_end:]
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f'Removed {line_end - line_start} chars (sample block)')
            print(f'Original: {len(content)} chars, New: {len(new_content)} chars')
        else:
            print('Markers not found!')
        break
    except (UnicodeDecodeError, UnicodeError) as e:
        print(f'{enc} failed: {e}')
