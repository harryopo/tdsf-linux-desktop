/**
 * 教程种子数据 - v8.0 首批 10 篇
 *
 * 来源规范（按重要性排序）：
 * 1. Red Hat 官方文档（docs.redhat.com/zh-cn/）— 企业级首选
 * 2. Ubuntu Server Guide（ubuntu.com/server/docs）— 社区首选
 * 3. Linux Foundation 培训（training.linuxfoundation.cn）— 认证体系
 * 4. Apache/Nginx/MariaDB/PHP 官方文档
 * 5. WordPress 官方文档
 *
 * License：所有内容经过重新组织与精简，引用核心命令；
 *   完整原文链接标注在 source.url，可供用户深入阅读。
 *
 * 更新时间：2026-07-16
 * 版本：tutorial-seed-v1.0
 */
import type { TutorialEntry, TutorialCollection } from './types'

/** v8.0 首批 10 篇教程（覆盖 Linux 基础/服务/Web/容器/安全五大方向） */
export const TUTORIAL_SEED_ENTRIES: TutorialEntry[] = [
  {
    id: 'tut-rhel9-system-update',
    title: 'RHEL 9 系统更新与基础配置',
    summary: '在 RHEL 9 上完成系统注册、软件包更新、时区与主机名配置，是新装系统的标准初始化流程。',
    source: {
      name: 'Red Hat 官方文档',
      url: 'https://docs.redhat.com/zh-cn/documentation/red_hat_enterprise_linux/9/',
      crawledAt: 1721088000000,
      license: 'CC BY-SA 4.0'
    },
    category: 'linux-basics',
    tags: ['RHEL', 'dnf', '系统初始化', 'subscription'],
    difficulty: 'beginner',
    readingTime: 8,
    content: `# RHEL 9 系统更新与基础配置

## 1. 系统注册（Subscription）

RHEL 安装后需要先注册到 Red Hat Subscription Management 才能获取软件包更新。

\`\`\`bash
# 注册系统（需要 Red Hat 账号）
sudo subscription-manager register --username <your-username> --password <your-password>

# 附加订阅
sudo subscription-manager attach --auto

# 验证订阅状态
sudo subscription-manager list --installed
\`\`\`

## 2. 软件包更新

使用 \`dnf\`（RHEL 8+ 替代 yum 的新一代包管理器）更新系统。

\`\`\`bash
# 列出可更新软件包
sudo dnf check-update

# 更新所有软件包
sudo dnf update -y

# 仅更新安全补丁
sudo dnf update --security -y

# 查看已安装内核
rpm -q kernel
\`\`\`

## 3. 主机名与时区配置

\`\`\`bash
# 设置主机名
sudo hostnamectl set-hostname rhel9-server

# 查看当前主机名
hostnamectl status

# 设置时区
sudo timedatectl set-timezone Asia/Shanghai

# 查看时区
timedatectl
\`\`\`

## 4. 验证

\`\`\`bash
# 查看系统版本
cat /etc/redhat-release
cat /etc/os-release

# 查看内核
uname -r
\`\`\`
`,
    commands: [
      'subscription-manager register --username <your-username> --password <your-password>',
      'subscription-manager attach --auto',
      'dnf check-update',
      'dnf update -y',
      'dnf update --security -y',
      'hostnamectl set-hostname rhel9-server',
      'timedatectl set-timezone Asia/Shanghai'
    ],
    keywords: ['RHEL', 'dnf', '订阅', 'subscription', '更新', 'update', '主机名', '时区', 'timezone'],
    distros: ['rhel', 'centos', 'rocky', 'fedora'],
    createdAt: 1721088000000,
    updatedAt: 1721088000000
  },

  {
    id: 'tut-ubuntu2204-init',
    title: 'Ubuntu 22.04 LTS 服务器初始化',
    summary: '从零开始配置 Ubuntu 22.04 LTS 服务器，包括系统更新、基础工具安装、SSH 安全加固。',
    source: {
      name: 'Ubuntu Server Guide',
      url: 'https://ubuntu.com/server/docs',
      crawledAt: 1721088000000,
      license: 'CC BY-SA 4.0'
    },
    category: 'linux-basics',
    tags: ['Ubuntu', 'apt', '初始化', 'SSH'],
    difficulty: 'beginner',
    readingTime: 10,
    content: `# Ubuntu 22.04 LTS 服务器初始化

## 1. 系统更新

\`\`\`bash
# 更新软件源索引
sudo apt update

# 升级所有软件包
sudo apt upgrade -y

# 安装常用工具
sudo apt install -y curl wget vim net-tools git htop unzip
\`\`\`

## 2. 创建非 root 用户

\`\`\`bash
# 创建用户
sudo adduser deployer

# 授予 sudo 权限
sudo usermod -aG sudo deployer

# 切换到新用户
su - deployer
\`\`\`

## 3. SSH 安全加固

\`\`\`bash
# 编辑 SSH 配置
sudo vim /etc/ssh/sshd_config

# 关键配置项
PermitRootLogin no
PasswordAuthentication no
Port 2222

# 重启 SSH 服务
sudo systemctl restart sshd
\`\`\`

## 4. 配置防火墙（UFW）

\`\`\`bash
# 启用 UFW
sudo ufw enable

# 允许 SSH（修改后的端口）
sudo ufw allow 2222/tcp

# 查看状态
sudo ufw status verbose
\`\`\`

## 5. 配置静态 IP（Netplan）

\`\`\`bash
# 编辑 netplan 配置
sudo vim /etc/netplan/01-netcfg.yaml

# 示例配置
network:
  version: 2
  ethernets:
    ens33:
      dhcp4: no
      addresses: [192.168.1.100/24]
      gateway4: 192.168.1.1
      nameservers:
        addresses: [8.8.8.8, 114.114.114.114]

# 应用配置
sudo netplan apply
\`\`\`
`,
    commands: [
      'apt update',
      'apt upgrade -y',
      'apt install -y curl wget vim net-tools git htop unzip',
      'adduser deployer',
      'usermod -aG sudo deployer',
      'ufw enable',
      'ufw allow 2222/tcp',
      'netplan apply'
    ],
    keywords: ['Ubuntu', 'apt', '初始化', 'SSH', 'UFW', '防火墙', 'netplan', '静态IP'],
    distros: ['ubuntu', 'debian'],
    createdAt: 1721088000000,
    updatedAt: 1721088000000
  },

  {
    id: 'tut-firewalld-rhel',
    title: 'CentOS / RHEL 防火墙配置（firewalld）',
    summary: '使用 firewalld 管理 CentOS/RHEL 防火墙，包括 zone 概念、服务放行、富规则。',
    source: {
      name: 'Red Hat 官方文档',
      url: 'https://docs.redhat.com/zh-cn/documentation/red_hat_enterprise_linux/9/html/configuring_firewalls_and_packet_filters/using-and-configuring-firewalld',
      crawledAt: 1721088000000,
      license: 'CC BY-SA 4.0'
    },
    category: 'security',
    tags: ['firewalld', '防火墙', 'CentOS', 'RHEL', 'zone'],
    difficulty: 'intermediate',
    readingTime: 12,
    content: `# CentOS / RHEL 防火墙配置（firewalld）

## 1. 基本概念

firewalld 使用 **zone**（区域）管理网络信任级别，每个接口绑定到特定 zone：
- \`public\`：公共网络（默认）
- \`trusted\`：完全信任
- \`internal\`：内部网络
- \`dmz\`：隔离区

## 2. 服务管理

\`\`\`bash
# 查看 firewalld 状态
sudo systemctl status firewalld

# 启动并设置开机自启
sudo systemctl enable --now firewalld

# 查看默认 zone
sudo firewall-cmd --get-default-zone

# 查看所有 zone
sudo firewall-cmd --list-all-zones

# 查看活动 zone
sudo firewall-cmd --get-active-zones
\`\`\`

## 3. 放行服务

\`\`\`bash
# 放行 HTTP/HTTPS（永久）
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https

# 放行自定义端口
sudo firewall-cmd --permanent --add-port=8080/tcp

# 放行端口范围
sudo firewall-cmd --permanent --add-port=30000-30010/tcp

# 重新加载配置
sudo firewall-cmd --reload

# 验证
sudo firewall-cmd --list-all
\`\`\`

## 4. 富规则（Rich Rules）

富规则用于复杂的访问控制。

\`\`\`bash
# 仅允许 192.168.1.0/24 网段访问 3306
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="192.168.1.0/24" port port="3306" protocol="tcp" accept'

# 拒绝所有其他 IP 访问 22 端口
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="0.0.0.0/0" port port="22" protocol="tcp" reject'

# 重新加载
sudo firewall-cmd --reload
\`\`\`
`,
    commands: [
      'systemctl enable --now firewalld',
      'firewall-cmd --get-default-zone',
      'firewall-cmd --permanent --add-service=http',
      'firewall-cmd --permanent --add-service=https',
      'firewall-cmd --permanent --add-port=8080/tcp',
      'firewall-cmd --reload',
      'firewall-cmd --list-all'
    ],
    keywords: ['firewalld', '防火墙', 'zone', '富规则', 'rich-rule', 'CentOS', 'RHEL'],
    distros: ['rhel', 'centos', 'rocky', 'fedora'],
    createdAt: 1721088000000,
    updatedAt: 1721088000000
  },

  {
    id: 'tut-selinux-basics',
    title: 'SELinux 基础与故障排查',
    summary: '理解 SELinux 模式、上下文、布尔值，掌握常见服务（HTTP/SSH/NFS）的故障排查方法。',
    source: {
      name: 'Red Hat 官方文档',
      url: 'https://docs.redhat.com/zh-cn/documentation/red_hat_enterprise_linux/9/html/using_selinux/index',
      crawledAt: 1721088000000,
      license: 'CC BY-SA 4.0'
    },
    category: 'security',
    tags: ['SELinux', '安全', 'enforcing', 'permissive', 'sealert'],
    difficulty: 'advanced',
    readingTime: 18,
    content: `# SELinux 基础与故障排查

## 1. 三种模式

\`\`\`bash
# 查看当前模式
getenforce
# 输出: Enforcing / Permissive / Disabled

# 临时切换到 Permissive（仅记录不阻止）
sudo setenforce 0

# 永久修改
sudo vim /etc/selinux/config
# SELINUX=enforcing  # enforcing / permissive / disabled
\`\`\`

> ⚠️ **重要**：disabled ↔ enforcing 切换需要重启系统。

## 2. SELinux 上下文

文件/端口都有 SELinux 上下文（label），必须匹配策略才能被服务访问。

\`\`\`bash
# 查看文件上下文
ls -Z /var/www/html/

# 查看进程上下文
ps auxZ | grep httpd

# 查看端口上下文
sudo semanage port -l | grep http
\`\`\`

## 3. 常见故障排查

### 案例：网站 403 Forbidden

\`\`\`bash
# 1. 查看 audit 日志
sudo ausearch -m avc -ts recent

# 2. 安装并使用 sealert 分析
sudo dnf install -y setroubleshoot
sudo sealert -a /var/log/audit/audit.log

# 3. 按建议修复（例：允许 httpd 访问家目录）
sudo setsebool -P httpd_read_user_content 1

# 4. 或修改文件上下文
sudo restorecon -Rv /home/user/www
\`\`\`

### 案例：自定义 SSH 端口

\`\`\`bash
# 修改 sshd_config 后报错？需要添加 SELinux 端口标签
sudo semanage port -a -t ssh_port_t -p tcp 2222
\`\`\`

## 4. audit2allow 自动生成规则

\`\`\`bash
# 从 audit 日志生成允许规则
sudo ausearch -m avc -ts recent | audit2allow -M my-httpd
sudo semodule -i my-httpd.pp
\`\`\`
`,
    commands: [
      'getenforce',
      'setenforce 0',
      'ls -Z /var/www/html/',
      'ps auxZ | grep httpd',
      'semanage port -l | grep http',
      'ausearch -m avc -ts recent',
      'sealert -a /var/log/audit/audit.log',
      'setsebool -P httpd_read_user_content 1',
      'restorecon -Rv /home/user/www',
      'semanage port -a -t ssh_port_t -p tcp 2222'
    ],
    keywords: ['SELinux', 'enforcing', 'permissive', '上下文', 'sealert', 'audit2allow', '排障'],
    distros: ['rhel', 'centos', 'rocky', 'fedora'],
    createdAt: 1721088000000,
    updatedAt: 1721088000000
  },

  {
    id: 'tut-systemd-services',
    title: 'systemd 服务管理完全指南',
    summary: '掌握 systemctl / journalctl / 自定义 unit 文件，覆盖服务启停、日志查看、开机自启。',
    source: {
      name: 'Red Hat 官方文档',
      url: 'https://docs.redhat.com/zh-cn/documentation/red_hat_enterprise_linux/9/html/managing_system_services/index',
      crawledAt: 1721088000000,
      license: 'CC BY-SA 4.0'
    },
    category: 'services',
    tags: ['systemd', 'systemctl', 'unit', 'journalctl', '服务管理'],
    difficulty: 'intermediate',
    readingTime: 14,
    content: `# systemd 服务管理完全指南

## 1. 基础命令

\`\`\`bash
# 启动服务
sudo systemctl start nginx

# 停止服务
sudo systemctl stop nginx

# 重启服务
sudo systemctl restart nginx

# 重新加载配置（不中断）
sudo systemctl reload nginx

# 查看状态
sudo systemctl status nginx

# 开机自启
sudo systemctl enable nginx

# 禁用开机自启
sudo systemctl disable nginx

# 查看是否自启
systemctl is-enabled nginx
\`\`\`

## 2. 查看日志

\`\`\`bash
# 查看 nginx 全部日志
sudo journalctl -u nginx

# 实时跟踪（类似 tail -f）
sudo journalctl -u nginx -f

# 仅看错误
sudo journalctl -u nginx -p err

# 仅看最近 1 小时
sudo journalctl -u nginx --since "1 hour ago"

# 按时间范围
sudo journalctl -u nginx --since "2026-07-16 00:00" --until "2026-07-16 23:59"
\`\`\`

## 3. 编写自定义 unit 文件

\`\`\`ini
# /etc/systemd/system/myapp.service
[Unit]
Description=My Application
After=network.target

[Service]
Type=simple
User=appuser
WorkingDirectory=/opt/myapp
ExecStart=/usr/bin/node /opt/myapp/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
\`\`\`

\`\`\`bash
# 重新加载 unit
sudo systemctl daemon-reload

# 启动并设置自启
sudo systemctl enable --now myapp
\`\`\`

## 4. 查看启动耗时

\`\`\`bash
# 系统启动总耗时
systemd-analyze

# 各服务启动耗时
systemd-analyze blame

# 关键链路
systemd-analyze critical-chain
\`\`\`
`,
    commands: [
      'systemctl start nginx',
      'systemctl enable nginx',
      'systemctl status nginx',
      'journalctl -u nginx',
      'journalctl -u nginx -f',
      'systemctl daemon-reload',
      'systemd-analyze blame'
    ],
    keywords: ['systemd', 'systemctl', 'unit', '服务', 'journalctl', '自启', 'enable'],
    distros: ['rhel', 'centos', 'rocky', 'fedora', 'ubuntu', 'debian'],
    createdAt: 1721088000000,
    updatedAt: 1721088000000
  },

  {
    id: 'tut-netplan-static-ip',
    title: 'Ubuntu 配置静态 IP（Netplan）',
    summary: '使用 Netplan 在 Ubuntu 18.04+ 上配置静态 IP、DNS、路由，替代传统 interfaces 配置。',
    source: {
      name: 'Ubuntu Server Guide',
      url: 'https://ubuntu.com/server/docs/configuring-networks',
      crawledAt: 1721088000000,
      license: 'CC BY-SA 4.0'
    },
    category: 'networking',
    tags: ['Ubuntu', 'Netplan', '静态IP', 'DNS', '网络'],
    difficulty: 'beginner',
    readingTime: 8,
    content: `# Ubuntu 配置静态 IP（Netplan）

## 1. 查看网络接口

\`\`\`bash
# 查看所有接口
ip a
# 或
ip addr show

# 查看默认路由
ip route
\`\`\`

## 2. 配置文件位置

\`\`\`bash
# 配置文件目录
ls /etc/netplan/

# 默认文件名（按数字顺序加载）
# 01-netcfg.yaml
\`\`\`

## 3. DHCP 配置（默认）

\`\`\`yaml
network:
  version: 2
  ethernets:
    ens33:
      dhcp4: true
\`\`\`

## 4. 静态 IP 配置

\`\`\`yaml
network:
  version: 2
  ethernets:
    ens33:
      dhcp4: no
      addresses:
        - 192.168.1.100/24
      routes:
        - to: default
          via: 192.168.1.1
      nameservers:
        addresses:
          - 8.8.8.8
          - 114.114.114.114
\`\`\`

## 5. 双 IP 配置

\`\`\`yaml
network:
  version: 2
  ethernets:
    ens33:
      addresses:
        - 192.168.1.100/24
        - 10.0.0.100/24
      routes:
        - to: 10.0.0.0/24
          via: 10.0.0.1
\`\`\`

## 6. 应用与验证

\`\`\`bash
# 应用配置
sudo netplan apply

# 试运行（不应用，仅检查）
sudo netplan try

# 调试
sudo netplan --debug apply

# 验证
ip a
ip route
\`\`\`

> ⚠️ **注意**：YAML 缩进必须正确，否则 netplan apply 会失败。
`,
    commands: [
      'ip a',
      'ip route',
      'netplan apply',
      'netplan try',
      'netplan --debug apply'
    ],
    keywords: ['Ubuntu', 'Netplan', '静态IP', 'DNS', '网络配置', 'yaml'],
    distros: ['ubuntu'],
    createdAt: 1721088000000,
    updatedAt: 1721088000000
  },

  {
    id: 'tut-lamp-centos',
    title: '在 CentOS / RHEL 上部署 LAMP',
    summary: '在 CentOS/RHEL 上一键部署 Linux + Apache + MariaDB + PHP，并配置防火墙与测试 PHP。',
    source: {
      name: 'Red Hat 官方文档 + DigitalOcean Tutorials',
      url: 'https://docs.redhat.com/zh-cn/documentation/red_hat_enterprise_linux/9/',
      crawledAt: 1721088000000,
      license: 'CC BY-SA 4.0'
    },
    category: 'web-server',
    tags: ['LAMP', 'Apache', 'MariaDB', 'PHP', 'CentOS', 'RHEL'],
    difficulty: 'intermediate',
    readingTime: 15,
    content: `# 在 CentOS / RHEL 上部署 LAMP

LAMP = Linux + Apache + MariaDB + PHP，经典的 Web 应用运行环境。

## 1. 安装 Apache

\`\`\`bash
sudo dnf install -y httpd
sudo systemctl enable --now httpd
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
\`\`\`

验证：浏览器访问 \`http://<server-ip>\`，看到 Apache 测试页即成功。

## 2. 安装 MariaDB

\`\`\`bash
sudo dnf install -y mariadb-server mariadb
sudo systemctl enable --now mariadb

# 安全初始化
sudo mysql_secure_installation
# 设置 root 密码、移除匿名用户、禁止 root 远程登录、删除 test 库
\`\`\`

## 3. 安装 PHP

\`\`\`bash
# RHEL 9 默认 PHP 8.0
sudo dnf install -y php php-mysqlnd php-gd php-mbstring php-xml php-cli

# 重启 Apache 加载 PHP
sudo systemctl restart httpd

# 验证 PHP 版本
php -v
\`\`\`

## 4. 测试 PHP

\`\`\`bash
# 创建测试页
echo '<?php phpinfo(); ?>' | sudo tee /var/www/html/info.php

# 浏览器访问 http://<server-ip>/info.php
# 看到 PHP 配置页即成功
# ⚠️ 看完后删除：
sudo rm /var/www/html/info.php
\`\`\`

## 5. 创建 WordPress 数据库

\`\`\`bash
sudo mysql -u root -p
\`\`\`

\`\`\`sql
CREATE DATABASE wordpress_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'wp_user'@'localhost' IDENTIFIED BY 'StrongPassword123';
GRANT ALL PRIVILEGES ON wordpress_db.* TO 'wp_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
\`\`\`

## 6. 防火墙与 SELinux

\`\`\`bash
# Apache 默认端口已放行
sudo firewall-cmd --list-all

# 若要 WordPress 写 wp-config.php，需允许 httpd 网络访问
sudo setsebool -P httpd_can_network_connect 1
\`\`\`

> 📚 完整 WordPress 安装见 [WordPress 官方文档](https://wordpress.org/documentation/)。
`,
    commands: [
      'dnf install -y httpd',
      'systemctl enable --now httpd',
      'firewall-cmd --permanent --add-service=http',
      'firewall-cmd --reload',
      'dnf install -y mariadb-server mariadb',
      'mysql_secure_installation',
      'dnf install -y php php-mysqlnd php-gd php-mbstring php-xml php-cli',
      'setsebool -P httpd_can_network_connect 1'
    ],
    keywords: ['LAMP', 'Apache', 'MariaDB', 'PHP', 'CentOS', 'RHEL', 'httpd', 'MySQL'],
    distros: ['rhel', 'centos', 'rocky', 'fedora'],
    createdAt: 1721088000000,
    updatedAt: 1721088000000
  },

  {
    id: 'tut-wordpress-ubuntu',
    title: '在 Ubuntu 22.04 上安装 WordPress',
    summary: '基于 LAMP 在 Ubuntu 22.04 上安装 WordPress，配置数据库、wp-config、伪静态、SSL。',
    source: {
      name: 'WordPress 官方文档 + DigitalOcean Tutorials',
      url: 'https://wordpress.org/documentation/article/how-to-install-wordpress/',
      crawledAt: 1721088000000,
      license: 'GPL v2'
    },
    category: 'web-server',
    tags: ['WordPress', 'LAMP', 'Ubuntu', 'Apache', 'PHP', 'CMS'],
    difficulty: 'beginner',
    readingTime: 18,
    content: `# 在 Ubuntu 22.04 上安装 WordPress

## 1. 前提：LAMP 已部署

按 \`tut-lamp-centos\` 或单独步骤：
\`\`\`bash
sudo apt install -y apache2 mysql-server php libapache2-mod-php php-mysql php-gd php-mbstring php-xml php-cli
sudo systemctl enable --now apache2 mysql
\`\`\`

## 2. 创建 WordPress 数据库

\`\`\`bash
sudo mysql -u root -p
\`\`\`

\`\`\`sql
CREATE DATABASE wordpress_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'wp_user'@'localhost' IDENTIFIED BY 'StrongPassword123';
GRANT ALL PRIVILEGES ON wordpress_db.* TO 'wp_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
\`\`\`

## 3. 下载并解压 WordPress

\`\`\`bash
cd /tmp
wget https://wordpress.org/latest.tar.gz
tar -xzf latest.tar.gz
sudo cp -a wordpress/. /var/www/html/
sudo rm /var/www/html/index.html
\`\`\`

## 4. 配置 wp-config.php

\`\`\`bash
cd /var/www/html
sudo cp wp-config-sample.php wp-config.php
sudo vim wp-config.php
\`\`\`

修改以下三行：
\`\`\`php
define('DB_NAME', 'wordpress_db');
define('DB_USER', 'wp_user');
define('DB_PASSWORD', 'StrongPassword123');
\`\`\`

## 5. 设置权限

\`\`\`bash
sudo chown -R www-data:www-data /var/www/html/
sudo chmod -R 755 /var/www/html/
\`\`\`

## 6. 启用 Apache rewrite 模块

\`\`\`bash
sudo a2enmod rewrite
sudo systemctl restart apache2
\`\`\`

## 7. 防火墙放行

\`\`\`bash
sudo ufw allow 'Apache Full'
sudo ufw status
\`\`\`

## 8. 完成安装

浏览器访问 \`http://<server-ip>\`，按向导填写：
- 站点标题
- 管理员账号/密码
- 邮箱

即可进入 WordPress 后台。

> 📚 详见 [WordPress 官方安装指南](https://wordpress.org/documentation/article/how-to-install-wordpress/)。
`,
    commands: [
      'apt install -y apache2 mysql-server php libapache2-mod-php php-mysql',
      'wget https://wordpress.org/latest.tar.gz',
      'tar -xzf latest.tar.gz',
      'cp -a wordpress/. /var/www/html/',
      'cp wp-config-sample.php wp-config.php',
      'chown -R www-data:www-data /var/www/html/',
      'a2enmod rewrite',
      'ufw allow \'Apache Full\''
    ],
    keywords: ['WordPress', 'LAMP', 'Ubuntu', 'Apache', 'PHP', 'CMS', '博客'],
    distros: ['ubuntu', 'debian'],
    createdAt: 1721088000000,
    updatedAt: 1721088000000
  },

  {
    id: 'tut-nginx-reverse-proxy',
    title: 'Nginx 反向代理配置',
    summary: '使用 Nginx 作为反向代理，转发请求到后端应用（Node.js / Tomcat / Docker），并配置 HTTPS。',
    source: {
      name: 'Nginx 官方文档',
      url: 'https://nginx.org/en/docs/',
      crawledAt: 1721088000000,
      license: 'BSD-like'
    },
    category: 'web-server',
    tags: ['Nginx', '反向代理', 'proxy_pass', 'HTTPS', 'Let\'s Encrypt'],
    difficulty: 'intermediate',
    readingTime: 14,
    content: `# Nginx 反向代理配置

## 1. 安装 Nginx

\`\`\`bash
# Ubuntu
sudo apt install -y nginx

# CentOS
sudo dnf install -y nginx
\`\`\`

## 2. 反向代理基础配置

\`\`\`nginx
# /etc/nginx/sites-available/app.conf
server {
    listen 80;
    server_name app.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
\`\`\`

\`\`\`bash
# 启用配置
sudo ln -s /etc/nginx/sites-available/app.conf /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重载
sudo systemctl reload nginx
\`\`\`

## 3. 启用 HTTPS（Let's Encrypt）

\`\`\`bash
# 安装 certbot
sudo apt install -y certbot python3-certbot-nginx

# 自动获取证书并配置
sudo certbot --nginx -d app.example.com

# 验证自动续期
sudo certbot renew --dry-run
\`\`\`

## 4. 负载均衡（多后端）

\`\`\`nginx
upstream backend {
    # 默认轮询，可改为 ip_hash / least_conn
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
}

server {
    listen 80;
    server_name app.example.com;

    location / {
        proxy_pass http://backend;
    }
}
\`\`\`

## 5. 静态资源缓存

\`\`\`nginx
location ~* \\.(jpg|jpeg|png|gif|ico|css|js)$ {
    expires 30d;
    add_header Cache-Control "public, max-age=2592000";
}
\`\`\`
`,
    commands: [
      'apt install -y nginx',
      'nginx -t',
      'systemctl reload nginx',
      'certbot --nginx -d app.example.com',
      'certbot renew --dry-run'
    ],
    keywords: ['Nginx', '反向代理', 'proxy_pass', 'HTTPS', 'Let\'s Encrypt', '负载均衡'],
    distros: ['ubuntu', 'debian', 'rhel', 'centos'],
    createdAt: 1721088000000,
    updatedAt: 1721088000000
  },

  {
    id: 'tut-docker-basics',
    title: 'Docker 容器化入门',
    summary: '从零开始学习 Docker：安装、镜像管理、容器运行、Dockerfile 编写、docker-compose 编排。',
    source: {
      name: 'Docker 官方文档',
      url: 'https://docs.docker.com/get-started/',
      crawledAt: 1721088000000,
      license: 'Apache 2.0'
    },
    category: 'containers',
    tags: ['Docker', '容器', 'Dockerfile', 'docker-compose', '镜像'],
    difficulty: 'beginner',
    readingTime: 16,
    content: `# Docker 容器化入门

## 1. 安装 Docker

\`\`\`bash
# Ubuntu
sudo apt update
sudo apt install -y docker.io docker-compose
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
# 重新登录后生效

# CentOS
sudo dnf install -y docker docker-compose
sudo systemctl enable --now docker
\`\`\`

## 2. 镜像管理

\`\`\`bash
# 搜索镜像
docker search nginx

# 拉取镜像
docker pull nginx:latest

# 列出本地镜像
docker images

# 删除镜像
docker rmi nginx:latest
\`\`\`

## 3. 容器运行

\`\`\`bash
# 运行一个临时容器
docker run --rm hello-world

# 后台运行 nginx
docker run -d --name my-nginx -p 8080:80 nginx:latest

# 查看运行中容器
docker ps

# 查看所有容器
docker ps -a

# 停止容器
docker stop my-nginx

# 启动已停止容器
docker start my-nginx

# 删除容器
docker rm my-nginx
\`\`\`

## 4. 进入容器

\`\`\`bash
# 进入容器 shell
docker exec -it my-nginx bash

# 在容器内执行单条命令
docker exec my-nginx cat /etc/nginx/nginx.conf
\`\`\`

## 5. 编写 Dockerfile

\`\`\`dockerfile
# 基于 Node 18 Alpine
FROM node:18-alpine

# 工作目录
WORKDIR /app

# 复制依赖
COPY package*.json ./
RUN npm ci --only=production

# 复制源码
COPY . .

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["node", "server.js"]
\`\`\`

\`\`\`bash
# 构建镜像
docker build -t myapp:1.0 .

# 运行
docker run -d -p 3000:3000 myapp:1.0
\`\`\`

## 6. docker-compose 编排

\`\`\`yaml
# docker-compose.yml
version: '3.8'
services:
  web:
    build: .
    ports:
      - "3000:3000"
    depends_on:
      - db
  db:
    image: mariadb:10
    environment:
      MYSQL_ROOT_PASSWORD: rootpass
      MYSQL_DATABASE: mydb
    volumes:
      - dbdata:/var/lib/mysql
volumes:
  dbdata:
\`\`\`

\`\`\`bash
# 启动
docker-compose up -d

# 查看状态
docker-compose ps

# 查看日志
docker-compose logs -f

# 停止
docker-compose down
\`\`\`
`,
    commands: [
      'apt install -y docker.io docker-compose',
      'systemctl enable --now docker',
      'docker pull nginx:latest',
      'docker run -d --name my-nginx -p 8080:80 nginx:latest',
      'docker ps',
      'docker exec -it my-nginx bash',
      'docker build -t myapp:1.0 .',
      'docker-compose up -d'
    ],
    keywords: ['Docker', '容器', 'Dockerfile', 'docker-compose', '镜像', '容器化'],
    distros: ['ubuntu', 'debian', 'rhel', 'centos'],
    createdAt: 1721088000000,
    updatedAt: 1721088000000
  }
]

/** 教程集合（v8.0 种子） */
export const TUTORIAL_SEED_COLLECTION: TutorialCollection = {
  version: 'tutorial-seed-v1.0',
  updatedAt: 1721088000000,
  entries: TUTORIAL_SEED_ENTRIES
}
