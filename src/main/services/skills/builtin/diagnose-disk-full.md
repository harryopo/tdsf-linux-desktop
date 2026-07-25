---
# ============================================================
# Skill: 磁盘空间满诊断
# ============================================================
name: diagnose-disk-full
description: |
  诊断 Linux 磁盘空间不足问题，定位大文件和可清理空间，
  给出安全的清理建议。适用于学生遇到"No space left on device"的场景。

triggers:
  keywords:
    - "no space left on device"
    - "disk full"
    - "磁盘满"
    - "空间不足"
    - "write error"
    - "cannot create temporary file"
  patterns:
    - "No space left on device"
    - "df:\\s+.+\\s+100%\\s+/.*"
  semantic:
    - "磁盘满了写不了文件"
    - "硬盘空间不够了"
    - "无法写入文件提示空间不足"

riskLevel: medium
category: troubleshooting
tags: [disk, storage, filesystem, cleanup]

teaching:
  principle: |
    ## 磁盘满的常见原因

    1. **日志文件膨胀**：/var/log 下的日志未轮转
    2. **临时文件堆积**：/tmp 未定期清理
    3. **包管理器缓存**：apt/yum 缓存未清理
    4. **大文件遗忘**：下载的 ISO、备份文件
    5. **删除未释放**：文件被删除但进程仍持有 fd（句柄）

    ## inode 耗尽 vs 空间耗尽

    - **空间耗尽**：`df -h` 显示 Use% = 100%
    - **inode 耗尽**：`df -i` 显示 IUse% = 100%（小文件太多）
    - 两者都会报 "No space left on device"，但原因不同！

  analogy: |
    磁盘就像一个仓库：
    - 空间耗尽 = 仓库塞满了大箱子（大文件）
    - inode 耗尽 = 仓库塞满了小盒子（海量小文件）
    - 两种情况都进不去货，但清理方法不同

  pitfalls:
    - "不要直接 rm 大日志文件，可能导致进程崩溃，先 truncate"
    - "删除文件后空间没释放？是有进程还持有该文件，需重启进程"
    - "df 显示有空间但写不了？可能是 inode 耗尽，查 df -i"
    - "不要清理 /proc、/sys、/dev 下的文件，这些是虚拟文件系统"
    - "清理前先备份重要数据，rm -rf 不可逆"

  exercise:
    - title: "制造磁盘满场景并诊断"
      steps:
        - "创建大文件：dd if=/dev/zero of=/tmp/bigfile bs=1M count=5000"
        - "查看磁盘：df -h"
        - "定位大文件：du -sh /tmp/*"
        - "清理：rm /tmp/bigfile"
    - title: "inode 耗尽实验"
      steps:
        - "创建海量小文件：for i in $(seq 1 100000); do touch /tmp/file_$i; done"
        - "df -h 有空间但 df -i 满了"
        - "清理：rm /tmp/file_*"

rollback:
  - "如果误删了日志：从备份恢复，或检查 journalctl"
  - "如果误删了配置：从 git 或包管理器重装"
  - "如果 rm 后空间没释放：lsof | grep deleted 找到持有进程，重启它"

hooks:
  preCheck:
    - "检查磁盘使用：df -h"
    - "检查 inode 使用：df -i"
  postVerify:
    - "确认空间已释放：df -h"
    - "确认服务正常：systemctl status {service-name}"
  onSuccess: "sediment-skill disk-full-diagnosis"
  onFailure: "escalate-to-ai"
---

# 磁盘空间满诊断步骤

## Step 1: 确认磁盘使用情况

```bash
# 查看所有分区使用情况（人类可读格式）
df -h

# 查看 inode 使用情况（排查小文件耗尽）
df -i

# 重点关注 Use% > 90% 的分区
df -h | awk '$5+0 > 90 {print}'
```

**判断要点**：
- `Use%` = 100% → 空间耗尽
- `IUse%` = 100% → inode 耗尽（小文件太多）
- 两者都可能报 "No space left on device"

## Step 2: 定位大目录

```bash
# 查看根目录下各目录大小（排序）
sudo du -sh /* 2>/dev/null | sort -rh | head -10

# 深入大目录逐层查找
sudo du -sh /var/* 2>/dev/null | sort -rh | head -10
sudo du -sh /var/log/* 2>/dev/null | sort -rh | head -10
sudo du -sh /home/* 2>/dev/null | sort -rh | head -10
```

## Step 3: 定位大文件

```bash
# 查找大于 100MB 的文件（在指定目录下）
sudo find / -type f -size +100M 2>/dev/null | head -20

# 查找最近 7 天修改的大文件
sudo find / -type f -size +50M -mtime -7 2>/dev/null | head -20

# 查找最大的 20 个文件
sudo find / -type f -exec du -h {} + 2>/dev/null | sort -rh | head -20
```

## Step 4: 安全清理

### 4.1 清理日志（最安全）

```bash
# 查看日志大小
sudo du -sh /var/log/*

# 清理已轮转的旧日志（.gz 文件）
sudo find /var/log -name "*.gz" -mtime +30 -delete

# 清空大日志文件（不要 rm，用 truncate 释放空间但保留文件）
sudo truncate -s 0 /var/log/syslog
sudo truncate -s 0 /var/log/kern.log

# 配置日志轮转（长期方案）
sudo nano /etc/logrotate.conf
```

### 4.2 清理包管理器缓存

```bash
# Debian/Ubuntu
sudo apt clean          # 清理下载的包文件
sudo apt autoclean      # 只清理过期的包
sudo apt autoremove     # 删除不需要的依赖

# CentOS/RHEL
sudo yum clean all
sudo dnf clean all
```

### 4.3 清理临时文件

```bash
# 清理 /tmp（小心，不要删正在使用的文件）
sudo find /tmp -type f -atime +7 -delete

# 清理用户缓存
rm -rf ~/.cache/*
```

### 4.4 清理 journalctl 日志

```bash
# 查看 journal 日志大小
journalctl --disk-usage

# 只保留最近 7 天
sudo journalctl --vacuum-time=7d

# 或只保留 500MB
sudo journalctl --vacuum-size=500M
```

## Step 5: 处理"删除未释放"

```bash
# 查找已删除但被进程持有的文件（空间未释放）
sudo lsof +L1 | grep deleted

# 或用（更简洁）
sudo lsof | grep deleted

# 解决方案：重启持有该文件的进程
sudo systemctl restart {service-name}

# 或直接 kill 进程（谨慎）
sudo kill -9 {PID}
```

## Step 6: inode 耗尽处理

```bash
# 如果是 inode 耗尽（df -i 显示 100%）
# 查找哪个目录文件数最多
sudo find / -xdev -printf '%h\n' | cut -d/ -f1-3 | sort | uniq -c | sort -k1 -rn | head

# 常见元凶：
# - /tmp 下的海量小文件
# - /var/spool/postfix 邮件队列
# - /proc 下的进程文件（不要删！）
# - 某个程序的日志按秒切割
```

## 教学总结

| 问题类型 | 诊断命令 | 清理方法 |
|----------|---------|---------|
| 空间耗尽 | `df -h` + `du -sh` | truncate 日志 / apt clean |
| inode 耗尽 | `df -i` + find 计数 | 删除海量小文件 |
| 删除未释放 | `lsof +L1` | 重启持有进程 |
| 日志膨胀 | `du -sh /var/log` | 配置 logrotate |

## 相关命令（CET-4 词汇标注）

- `df` (disk free) — 磁盘可用空间
- `du` (disk usage) — 磁盘使用量
- `find` (find) — 查找文件
- `truncate` (truncate) — 截断文件
- `lsof` (list open files) — 列出打开的文件
- `inode` (index node) — 索引节点
- `vacuum` (vacuum) — 清理（journalctl 选项）
