---
# ============================================================
# Skill: 网络不通诊断
# ============================================================
name: diagnose-network-issue
description: |
  诊断 Linux 网络连接问题，从物理层到应用层逐层排查，
  定位网络不通的根因。适用于学生遇到"ping 不通""连不上"的场景。

triggers:
  keywords:
    - "network is unreachable"
    - "connection refused"
    - "connection timed out"
    - "no route to host"
    - "name resolution"
    - "ping"
    - "网络不通"
    - "连不上"
    - "无法连接"
  patterns:
    - "connect: Network is unreachable"
    - "connect: Connection refused"
    - "connect: Connection timed out"
    - "ping: .+: Name or service not known"
    - "Temporary failure in name resolution"
  semantic:
    - "网站打不开"
    - "服务连不上"
    - "网络断了"

riskLevel: low
category: troubleshooting
tags: [network, tcp, dns, firewall, connectivity]

teaching:
  principle: |
    ## 网络诊断的 OSI 七层模型

    排查网络问题要**从下往上**逐层检查：

    | 层级 | 检查内容 | 命令 |
    |------|---------|------|
    | 物理层 | 网卡是否启用 | `ip link` |
    | 数据链路层 | 是否有 IP | `ip addr` |
    | 网络层 | 能否 ping 网关 | `ping 网关IP` |
    | 网络层 | 能否 ping 外网 | `ping 8.8.8.8` |
    | 传输层 | 端口是否监听 | `ss -tlnp` |
    | 应用层 | DNS 解析 | `nslookup` |
    | 应用层 | HTTP 连通 | `curl` |

    ## 三种"连不上"的区别

    1. **Connection refused**：对方端口没开（服务没启动）
    2. **Connection timed out**：防火墙拦截或路由不通
    3. **Network is unreachable**：本机没有路由到目标

  analogy: |
    网络就像寄快递：
    - 物理层断 = 公路塌方（网卡 down）
    - 没 IP = 没有发件地址
    - ping 不通网关 = 快递员到不了集散中心
    - ping 不通外网 = 集散中心到不了目的地
    - DNS 失败 = 不知道收件人地址
    - 端口不开 = 收件人不在家
    - 防火墙拦截 = 保安不让进

  pitfalls:
    - "ping 不通不代表网络不通，有些服务器禁 ICMP"
    - "能 ping IP 但不能 ping 域名 → DNS 问题，不是网络问题"
    - "防火墙是双层的：firewalld + iptables 都要查"
    - "localhost 和 0.0.0.0 监听的区别：前者只能本机连，后者所有网卡都能连"
    - "SELinux 也可能拦截网络，不要忽略"

  exercise:
    - title: "模拟网络故障并诊断"
      steps:
        - "关闭网卡：sudo ip link set eth0 down"
        - "测试连通性：ping 8.8.8.8（失败）"
        - "查看网卡：ip link（DOWN 状态）"
        - "恢复：sudo ip link set eth0 up"
    - title: "防火墙拦截实验"
      steps:
        - "启动 nginx：sudo systemctl start nginx"
        - "本机可访问：curl localhost:80"
        - "开启防火墙拦截：sudo firewall-cmd --add-port=80/tcp --permanent && sudo firewall-cmd --reload"
        - "外部不可访问（timeout）"

rollback:
  - "恢复网卡：sudo ip link set {interface} up"
  - "恢复防火墙：sudo firewall-cmd --remove-port={port}/tcp --permanent && sudo firewall-cmd --reload"
  - "恢复 DNS：echo 'nameserver 8.8.8.8' | sudo tee /etc/resolv.conf"

hooks:
  preCheck:
    - "检查网卡状态：ip link show"
    - "检查路由表：ip route"
  postVerify:
    - "确认连通性：ping -c 3 8.8.8.8"
    - "确认 DNS：nslookup baidu.com"
  onSuccess: "sediment-skill network-diagnosis"
  onFailure: "escalate-to-ai"
---

# 网络不通诊断步骤

## Step 1: 物理层 - 检查网卡

```bash
# 查看所有网卡及状态
ip link show

# 重点关注：UP/DOWN 状态
# 如果网卡是 DOWN 状态：
sudo ip link set eth0 up
```

## Step 2: 数据链路层 - 检查 IP

```bash
# 查看 IP 地址
ip addr show

# 或简洁版
ip -4 addr

# 如果没有 IP：
# DHCP 获取
sudo dhclient eth0

# 静态 IP 配置
sudo ip addr add 192.168.1.100/24 dev eth0
sudo ip link set eth0 up
```

## Step 3: 网络层 - 检查路由

```bash
# 查看路由表
ip route

# 确认有默认路由（default via ...）
# 如果没有默认路由：
sudo ip route add default via 192.168.1.1

# ping 网关
ping -c 3 192.168.1.1

# ping 外网 IP（绕过 DNS）
ping -c 3 8.8.8.8
```

**分层判断**：
- ping 网关不通 → 本机到路由器的问题（网线/网卡/IP 段）
- ping 网关通但 ping 外网不通 → 路由器/运营商问题
- ping IP 通但 ping 域名不通 → DNS 问题（跳到 Step 5）

## Step 4: DNS 诊断

```bash
# 测试 DNS 解析
nslookup baidu.com
# 或
dig baidu.com

# 如果 DNS 解析失败：
# 检查 DNS 配置
cat /etc/resolv.conf

# 临时修改 DNS
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
echo "nameserver 114.114.114.114" | sudo tee -a /etc/resolv.conf

# 测试特定 DNS 服务器
dig @8.8.8.8 baidu.com
```

## Step 5: 传输层 - 端口检查

```bash
# 查看本机监听端口
ss -tlnp
# 或
netstat -tlnp

# 检查特定端口是否监听
ss -tlnp | grep :80

# 测试目标端口连通性
# 方法 1: telnet
telnet 192.168.1.100 80

# 方法 2: nc（更强大）
nc -zv 192.168.1.100 80
# -z: 只扫描不发送数据
# -v: 显示详细信息

# 方法 3: curl
curl -v http://192.168.1.100:80
```

**三种结果的含义**：
- `Connection refused` → 端口没开（服务没启动）
- `Connection timed out` → 防火墙拦截或路由不通
- `Connected` → 端口正常

## Step 6: 防火墙检查

```bash
# firewalld（CentOS/RHEL 默认）
sudo firewall-cmd --list-all
sudo firewall-cmd --list-ports

# iptables（通用）
sudo iptables -L -n
sudo iptables -L -n | grep DROP

# ufw（Ubuntu 默认）
sudo ufw status

# 放行端口
# firewalld
sudo firewall-cmd --add-port=80/tcp --permanent
sudo firewall-cmd --reload

# iptables
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT

# ufw
sudo ufw allow 80/tcp
```

## Step 7: 抓包分析（进阶）

```bash
# 抓取指定端口的数据包
sudo tcpdump -i eth0 port 80 -nn

# 抓取指定主机的数据包
sudo tcpdump -i eth0 host 192.168.1.100 -nn

# 抓取并显示内容（HTTP 排查）
sudo tcpdump -i eth0 port 80 -A -nn

# 只抓前 10 个包
sudo tcpdump -i eth0 port 80 -nn -c 10
```

## Step 8: 路由追踪

```bash
# 追踪到目标的路由路径
traceroute 8.8.8.8
# 或
mtr 8.8.8.8  # mtr = traceroute + ping 的实时版

# 在哪一跳开始不通，就是哪里的问题
```

## 教学总结

| 症状 | 可能原因 | 诊断命令 |
|------|---------|---------|
| Network unreachable | 无路由 | `ip route` |
| Connection refused | 端口未开 | `ss -tlnp` |
| Connection timed out | 防火墙拦截 | `iptables -L` |
| Name resolution failed | DNS 故障 | `nslookup` |
| ping 不通但服务正常 | ICMP 被禁 | `curl` 测试 |

## 相关命令（CET-4 词汇标注）

- `ping` (ping) — 测试网络连通性
- `route` (route) — 路由
- `interface` (接口) — 网络接口
- `socket` (socket) — 套接字
- `resolve` (resolve) — 解析（DNS）
- `firewall` (firewall) — 防火墙
- `connect` (connect) — 连接
- `address` (address) — 地址
