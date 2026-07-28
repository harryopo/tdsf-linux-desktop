---
# ============================================================
# Skill: 权限错误诊断
# ============================================================
name: diagnose-permission-denied
description: |
  诊断 Linux 权限错误，解释 rwx 权限模型、用户/组/其他概念，
  给出正确的权限修复方案。适用于学生遇到"Permission denied"的场景。

triggers:
  keywords:
    - "permission denied"
    - "access denied"
    - "operation not permitted"
    - "权限不足"
    - "权限拒绝"
    - "拒绝访问"
  patterns:
    - "bash: .+: Permission denied"
    - "-bash: /.*: Permission denied"
    - "Permission denied \\(publickey\\)"
    - "sudo: .+: command not found"
  semantic:
    - "没有权限执行"
    - "提示权限不够"
    - "文件打不开说没权限"

riskLevel: medium
category: troubleshooting
tags: [permission, security, user, chmod, chown, sudo]
---

teaching:
  principle: |
    ## Linux 权限模型

    每个文件有 3 类用户 × 3 种权限 = 9 个权限位：

    | 用户类型 | 含义 | 代号 |
    |---------|------|------|
    | owner | 文件所有者 | u |
    | group | 所属组 | g |
    | others | 其他用户 | o |
    | all | 所有人 | a |

    | 权限 | 数字 | 含义 | 对文件 | 对目录 |
    |------|------|------|--------|--------|
    | r | 4 | 读 | 查看内容 | 列出文件 |
    | w | 2 | 写 | 修改内容 | 创建/删除文件 |
    | x | 1 | 执行 | 运行 | 进入目录 |

    ## 常见权限场景

    - `755` (rwxr-xr-x)：目录/可执行文件标准权限
    - `644` (rw-r--r--)：普通文件标准权限
    - `600` (rw-------)：私钥文件权限（SSH key）
    - `400` (r--------)：只读配置文件
    - `777` (rwxrwxrwx)：**危险！** 所有人可写

    ## sudo 机制

    - `sudo`：以 root 身份执行单条命令（需输入自己密码）
    - `su`：切换到 root 用户（需输入 root 密码）
    - `sudo -i` / `sudo -s`：进入 root 交互式 shell

  analogy: |
    权限就像学校门禁系统：
    - owner = 班主任（可进可出可改）
    - group = 本班学生（可进可出）
    - others = 外班学生（只能看门口）
    - root = 校长（无视所有门禁）
    - sudo = 临时借用校长卡刷一次

  pitfalls:
    - "chmod 777 是最危险的权限，生产环境绝对不要用"
    - "改权限前先确认：是权限问题还是所有者问题"
    - "SSH 私钥权限必须是 600，否则 ssh 会拒绝使用"
    - "目录的 x 权限不是'执行'，是'能否进入'，没有 x 就 cd 不进去"
    - "sudo 不是万能的，sudo 也可能被 /etc/sudoers 限制"
    - "文件删除权限取决于目录的 w 权限，不是文件本身的 w 权限"

  exercise:
    - title: "权限实验"
      steps:
        - "创建文件：touch testfile"
        - "移除所有权限：chmod 000 testfile"
        - "尝试读取：cat testfile（Permission denied）"
        - "恢复权限：chmod 644 testfile"
    - title: "理解