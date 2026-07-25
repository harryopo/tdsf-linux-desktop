---
# ============================================================
# Skill: OOM Killer 诊断
# ============================================================
name: diagnose-oom-killer
description: |
  诊断 Linux OOM Killer（Out-Of-Memory Killer）触发原因，
  分析被杀进程，给出内存优化建议。
  适用于学生遇到"进程莫名被杀"的场景教学。

# 触发条件（满足任一即触发）
triggers:
  # 关键词触发（终端输出/用户提问匹配）
  keywords:
    - "oom"
    - "out of memory"
    - "killed process"
    - "Out of memory: Killed process"
    - "oom-killer"
    - "内存不足"
    - "进程被杀"
  # 正则模式触发（终端输出匹配）
  patterns:
    - "Killed process \\d+ \\(.+\\)"
    - "Out of memory: Killed process \\d+ .+"
    - "oom_reaper: reaped process \\d+"
  # 语义触发（AI 意图识别）
  semantic:
    - "进程莫名其妙消失了"
    - "程序运行到一半被杀了"
    - "系统自动杀了我的进程"

# 风险等级（low/medium/high/critical）
riskLevel: low
# Skill 分类
category: troubleshooting
# 标签（用于检索和过滤）
tags: [memory, linux, kernel, oom, process-management]

# 教学说明（TDSF 运维教学专用）
teaching:
  # 原理讲解
  principle: |
    ## OOM Killer 是什么？

    OOM Killer（Out-Of-Memory Killer）是 Linux 内核的**内存保护机制**。
    当系统物理内存和 Swap 都耗尽时，内核会自动选择一个"最该死"的进程杀掉，
    释放内存以保全系统不崩溃。

    ## oom_score 打分机制

    内核给每个进程打一个 `oom_score`（0-1000 分），分数越高越容易被杀：
    - 内存占用越多 → 分数越高
    - 运行时间越短 → 分数越高（"年轻"进程优先牺牲）
    - root 进程 → 分数减 30（保护系统进程）
    - `oom_score_adj` 可手动调整（-1000 到 1000）

    ## 为什么会被 OOM？

    1. **内存泄漏**：程序 bug，申请的内存不释放
    2. **资源不足**：机器内存太小，跑的任务太多
    3. **配置不当**：`vm.overcommit_memory=1` 允许超额分配
    4. **突发流量**：瞬间大量请求导致内存飙升

  # 形象类比（帮助学生理解）
  analogy: |
    想象教室有 50 个座位（物理内存），突然来了 60 个学生（进程）。
    老师内核）必须请 10 个学生出去，否则教室会塌。
    谁被请出去？刚来的、占座最多的、不是班干部的（root 进程）。
    这就是 OOM Killer 的工作逻辑。

  # 常见坑点（学生容易犯错）
  pitfalls:
    - "不要盲目调大 vm.overcommit_memory=1，这只是掩盖问题"
    - "不要一看到 OOM 就加内存，先查是不是内存泄漏"
    - "dmesg 日志会被覆盖，第一时间保存：dmesg -T > oom.log"
    - "被杀的进程不一定是罪魁祸首，可能是无辜的受害者"
    - "Swap 不是万能药，Swap 频繁触发会导致系统卡死"

  # 动手练习（教学场景）
  exercise:
    - title: "模拟 OOM 触发"
      steps:
        - "安装压力测试工具：sudo apt install stress"
        - "消耗内存：stress --vm 1 --vm-bytes 4G --timeout 30s"
        - "观察 dmesg：dmesg -T | tail -50"
        - "找到被杀进程：dmesg -T | grep 'Killed process'"
    - title: "调整 oom_score 保护关键进程"
      steps:
        - "查看进程 oom_score：cat /proc/$PID/oom_score"
        - "设置保护：echo -1000 > /proc/$PID/oom_score_adj"
        - "验证：该进程不会被 OOM 杀死"

# 回滚步骤（如果 Skill 执行导致问题，如何恢复）
rollback:
  - "恢复被杀的服务：sudo systemctl restart {service-name}"
  - "临时缓解（不根治）：echo 1 > /proc/sys/vm/compact_memory"
  - "释放缓存：echo 3 > /proc/sys/vm/drop_caches"
  - "如果误调了 overcommit：echo 0 > /proc/sys/vm/overcommit_memory"

# 钩子（前置检查 / 后置验证 / 成功/失败回调）
hooks:
  # 执行前检查
  preCheck:
    - "检查 dmesg 是否可读：dmesg -T | head -1"
    - "检查是否有 OOM 记录：dmesg -T | grep -c 'Killed process'"
  # 执行后验证
  postVerify:
    - "确认服务已恢复：systemctl status {service-name}"
    - "确认内存状态：free -h"
    - "确认无新 OOM：dmesg -T | tail -20 | grep -c 'Killed process'"
  # 成功后回调（沉淀为知识）
  onSuccess: "sediment-skill oom-diagnosis"
  # 失败后回调（升级到 AI）
  onFailure: "escalate-to-ai"
---

# OOM Killer 诊断步骤

## Step 1: 采集 OOM 日志

```bash
# 查看最近的 OOM 事件（带时间戳）
dmesg -T | grep -i "killed process\|oom-killer\|out of memory"

# 如果 dmesg 被清空，查 syslog
grep -i "killed process\|oom-killer" /var/log/syslog 2>/dev/null || \
journalctl -k --since "1 hour ago" | grep -i "killed process\|oom"
```

**关键信息提取**：
- 被杀进程名和 PID
- 被杀时的内存占用
- OOM 触发时间

## Step 2: 识别被杀进程

```bash
# 提取被杀进程的 PID 和名称
dmesg -T | grep "Killed process" | tail -5

# 示例输出：
# [Mon Jul 24 10:30:45 2026] Out of memory: Killed process 12345 (nginx) total-vm:2048000kB, anon-rss:1500000kB
```

**字段解读**：
- `total-vm`：进程申请的虚拟内存总量
- `anon-rss`：实际使用的物理内存（匿名页）
- 如果 `anon-rss` 很大 → 进程确实是内存大户

## Step 3: 分析当前内存状态

```bash
# 查看整体内存使用
free -h

# 查看内存详情
cat /proc/meminfo | grep -E "MemTotal|MemFree|MemAvailable|SwapTotal|SwapFree|Slab"

# 查看内存占用 TOP 10 进程
ps aux --sort=-%mem | head -11
```

**判断要点**：
- `MemAvailable` < 总内存 10% → 内存严重不足
- `SwapFree` < `SwapTotal` 10% → Swap 也快满了
- 某进程 `%MEM` > 50% → 找到内存大户

## Step 4: 诊断根因

### 4.1 内存泄漏检测

```bash
# 查看进程内存增长趋势（需要长期监控）
ps -o pid,comm,rss,vsz -p $PID

# 如果进程 RSS 持续增长不下降 → 可能是内存泄漏
# 检查进程打开的文件描述符（fd 泄漏也会导致内存增长）
ls /proc/$PID/fd | wc -l
```

### 4.2 配置检查

```bash
# 检查 overcommit 设置
cat /proc/sys/vm/overcommit_memory
# 0 = 启发式判断（默认，推荐）
# 1 = 总是允许（危险，容易 OOM）
# 2 = 严格限制（保守）

# 检查 Swap 大小
swapon --show
```

### 4.3 cgroup 限制检查（容器场景）

```bash
# 如果是容器，检查 cgroup 内存限制
cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null || \
cat /sys/fs/cgroup/memory.max 2>/dev/null

# 容器 OOM 和宿主机 OOM 机制不同：
# - 容器 OOM：只杀容器内进程（cgroup 级别）
# - 宿主机 OOM：杀任意进程（系统级别）
```

## Step 5: 给出修复建议

### 场景 A：内存泄漏

```bash
# 重启泄漏进程（临时方案）
sudo systemctl restart {service-name}

# 长期方案：排查代码内存泄漏，或升级版本
```

### 场景 B：资源不足

```bash
# 增加物理内存（最佳方案）
# 或增加 Swap（临时方案）
sudo fallocate -l 4G /swapfile2
sudo chmod 600 /swapfile2
sudo mkswap /swapfile2
sudo swapon /swapfile2

# 永久生效
echo '/swapfile2 none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 场景 C：保护关键进程

```bash
# 保护关键进程不被 OOM 杀（如 SSH、数据库）
# 找到进程 PID
PID=$(pgrep -f "sshd" | head -1)

# 设置 oom_score_adj = -1000（永远不会被杀）
echo -1000 | sudo tee /proc/$PID/oom_score_adj

# 永久生效（systemd 服务）
# 在 /etc/systemd/system/{service}.service 添加：
# [Service]
# OOMScoreAdjust=-1000
```

## Step 6: 验证修复

```bash
# 确认服务已恢复
sudo systemctl status {service-name}

# 确认内存状态正常
free -h

# 监控 10 分钟，确认无新 OOM
watch -n 60 'dmesg -T | tail -5 | grep -c "Killed process"'
```

## 教学总结

| 知识点 | 要点 |
|--------|------|
| OOM 触发条件 | 物理内存 + Swap 耗尽 |
| 进程选择算法 | oom_score 打分（内存越多分越高） |
| 诊断三板斧 | dmesg 看日志 + ps 看占用 + free 看整体 |
| 修复三方案 | 重启进程 / 加内存 / 调参数 |
| 预防措施 | 监控告警 + oom_score_adj 保护关键进程 |

## 相关命令（CET-4 词汇标注）

- `dmesg` (display message) — 显示内核日志
- `grep` (global regular expression print) — 全局正则匹配输出
- `ps` (process status) — 进程状态
- `free` — 显示内存使用情况
- `kill` — 终止进程
- `swap` (swap) — 交换空间
- `allocate` (分配) — 分配内存
- `memory` (内存) — 存储器
