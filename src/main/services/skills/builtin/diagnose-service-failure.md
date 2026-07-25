---
# ============================================================
# Skill: 服务启动失败诊断
# ============================================================
name: diagnose-service-failure
description: |
  诊断 Linux systemd 服务启动失败问题，分析 journalctl 日志，
  定位配置错误/依赖缺失/端口冲突等根因，给出修复方案。
  适用于学生遇到"Job for xxx.service failed"的场景教学。

triggers:
  keywords:
    - "failed to start"
    - "job for"
    - "service failed"
    - "inactive (dead)"
    - "failed (result: exit-code)"
    - "unit not found"
    - "服务启动失败"
    - "服务无法启动"
  patterns:
    - "Job for .+\\.service failed"
    - "Failed to start .+\\.service"
    - "Active: failed"
    - "status=[0-9]+/FAILURE"
  semantic:
    - "服务起不来"
    - "nginx 启动不了"
    - "httpd 无法启动"
    - "systemctl start 失败"

riskLevel: medium
category: troubleshooting
tags: [systemd, service, journalctl, nginx, httpd, sshd]

teaching:
  principle: |
    ## systemd 服务管理基础

    systemd 是现代 Linux 的 init 系统（PID 1），管理所有系统服务。
    每个服务对应一个 .service 单元文件，定义了启动命令、依赖关系、重启策略。

    ### 服务生命周期

    ```
    inactive → activating → active (running) → deactivating → inactive
                                    ↓
                                 failed
    ```

    ### 常见启动失败原因

    | 原因 | 症状 | 诊断方法 |
    |------|------|---------|
    | 配置文件语法错误 | exit-code 1 | `nginx -t` / `httpd -t` |
    | 端口被占用 | Address already in use | `ss -tlnp` |
    | 依赖缺失 | command not found | `ldd` / `which` |
    | 权限问题 | Permission denied | `ls -l` / `namei -l` |
    | SELinux 阻止 | audit log | `ausearch -m AVC` |
    | 配置文件不存在 | No such file | `ls -l /etc/xxx/` |

  analogy: |
    systemd 就像学校的总务处，每个服务就是一个"办公室"。
    - .service 文件 = 办公室的开门规则（几点开门、需要什么设备）
    - systemctl start = 总务处下令开门
    - 启动失败 = 门打不开（钥匙错了/房间被占/设备没到）
    - journalctl = 查看开门失败的原因记录

  pitfalls:
    - "不要只看 systemctl status，要看 journalctl -xe 详细日志"
    - "端口冲突是最常见原因，先 ss -tlnp 检查端口占用"
    - "配置文件改完要先验证语法（nginx -t），不要直接重启"
    - "SELinux 也会阻止服务启动，不要忽略 audit 日志"
    - "不要盲目 disable SELinux，这是安全问题，应该正确配置上下文"

rollback:
  - "恢复配置文件备份：sudo cp /etc/xxx.conf.bak /etc/xxx.conf"
  - "停止冲突服务：sudo systemctl stop conflict-service"
  - "恢复 SELinux 上下文：sudo restorecon -Rv /path/to/file"
  - "重置服务状态：sudo systemctl reset-failed xxx.service"

hooks:
  preCheck:
    - "检查服务是否存在：systemctl list-unit-files | grep xxx"
    - "检查服务文件：systemctl cat xxx.service"
  postVerify:
    - "确认服务状态：systemctl is-active xxx.service"
    - "确认端口监听：ss -tlnp | grep xxx"
    - "确认日志无新错误：journalctl -u xxx --since '1 min ago' --no-pager"
  onSuccess: "sediment-skill service-failure-diagnosis"
  onFailure: "escalate-to-ai"
---

# 服务启动失败诊断步骤

## Step 1: 查看服务状态

```bash
# systemctl = system control（系统服务控制）⭐四级词汇
# status = 状态
systemctl status nginx.service

# 关键信息提取：
# - Active: failed (Result: exit-code)  → 启动失败
# - Main PID: 1234 (code=exited, status=1/FAILURE)  → 退出码
# - 最后 10 行日志  → 失败原因线索
```

## Step 2: 查看详细日志

```bash
# journalctl = journal control（日志控制）⭐四级词汇
# -u = unit（指定服务单元）
# -xe = 详细输出 + 额外解释
# --no-pager = 不分页（直接输出全部）
journalctl -u nginx.service -xe --no-pager | tail -50

# 只看最近的错误
journalctl -u nginx.service --since "5 min ago" -p err --no-pager
```

**常见错误信息**：
- `Address already in use` → 端口被占用
- `Permission denied` → 权限问题
- `No such file or directory` → 配置文件或依赖缺失
- `Job for nginx.service failed` → 需要进一步查 journalctl

## Step 3: 定位根因

### 3.1 端口冲突检查

```bash
# ss = socket statistics（套接字统计）⭐四级词汇
# -t = TCP（仅显示 TCP 连接）
# -l = listening（仅显示监听端口）
# -n = numeric（不解析服务名，显示端口号）
# -p = processes（显示占用进程）
ss -tlnp | grep ':80 '

# 如果 80 端口被其他进程占用：
# 解决方案 1：停止冲突进程
sudo systemctl stop httpd.service  # 如果是 Apache 占用了

# 解决方案 2：修改 nginx 端口
sudo vim /etc/nginx/nginx.conf  # 改 listen 8080;
```

### 3.2 配置文件语法检查

```bash
# nginx 配置验证（nginx -t = test configuration）
nginx -t

# httpd/apache 配置验证
httpd -t
apachectl configtest

# SSH 配置验证
sshd -t

# 如果语法错误，会提示具体行号：
# nginx: [emerg] unexpected "}" in /etc/nginx/nginx.conf:45
```

### 3.3 依赖检查

```bash
# 检查服务二进制文件是否存在
which nginx
ls -l /usr/sbin/nginx

# 检查动态链接库（ldd = list dynamic dependencies）
ldd /usr/sbin/nginx | grep "not found"

# 如果有 "not found"，说明缺少依赖库
# 解决：安装缺失的依赖
sudo yum install -y missing-lib
```

### 3.4 SELinux 检查

```bash
# 查看 SELinux 状态
getenforce

# 如果是 Enforcing，检查是否有 AVC 拒绝
# ausearch = audit search（审计搜索）
sudo ausearch -m AVC -ts recent

# 常见 SELinux 问题：
# - 文件上下文不对 → restorecon -Rv /path/
# - 布尔值未开启 → setsebool -P httpd_can_network_connect on
# - 端口标签不对 → semanage port -a -t http_port_t -p tcp 8080
```

### 3.5 配置文件检查

```bash
# 查看服务配置文件
systemctl cat nginx.service

# 检查配置文件是否存在
ls -l /etc/nginx/nginx.conf
ls -l /etc/nginx/conf.d/

# 检查配置文件权限
namei -l /etc/nginx/nginx.conf
```

## Step 4: 修复并验证

```bash
# 修复后重启服务
sudo systemctl restart nginx.service

# 验证服务状态
systemctl is-active nginx.service  # 应该返回 active

# 验证端口监听
ss -tlnp | grep nginx

# 验证服务自启
systemctl is-enabled nginx.service
```

## 教学总结

| 知识点 | 要点 |
|--------|------|
| 服务状态机 | inactive → active → failed |
| 诊断三板斧 | systemctl status + journalctl -xe + 配置验证 |
| 端口冲突 | ss -tlnp 定位占用进程 |
| 配置验证 | nginx -t / httpd -t / sshd -t |
| SELinux | ausearch -m AVC 查拒绝 |
| systemd 设计哲学 | 声明式配置 + 依赖管理 + 日志集中 |

## 相关命令（CET-4 词汇标注）

- `systemctl` (system control) — 系统服务控制 ⭐
- `journalctl` (journal control) — 日志查看 ⭐
- `status` (状态) — 服务状态 ⭐
- `restart` (重启) — 重启服务 ⭐
- `enable` (启用) — 设置开机自启 ⭐
- `ss` (socket statistics) — 套接字统计
- `ldd` (list dynamic dependencies) — 列出动态依赖
- `restorecon` (restore context) — 恢复 SELinux 上下文
- `ausearch` (audit search) — 审计日志搜索
