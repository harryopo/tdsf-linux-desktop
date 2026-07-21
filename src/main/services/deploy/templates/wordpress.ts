/**
 * WordPress 一键部署模板
 *
 * 数据源：WordPress 官方文档 + DigitalOcean Tutorials
 * License：GPL v2
 * 测试环境：Ubuntu 22.04 LTS
 */

import type { DeployTemplate } from '../types'

/** WordPress 部署模板 */
export const WORDPRESS_TEMPLATE: DeployTemplate = {
  id: 'wordpress',
  name: 'WordPress 一键安装',
  summary: '在 Ubuntu 22.04 上基于 LAMP 一键部署 WordPress CMS',
  category: 'web-server',
  difficulty: 1,
  tutorialId: 'tut-wordpress-ubuntu',
  source: 'WordPress 官方文档',
  estimatedMinutes: 6,
  supportedDistros: ['ubuntu', 'debian'],
  variables: [
    {
      name: 'dbName',
      label: 'WordPress 数据库名',
      defaultValue: 'wordpress_db',
      required: true,
      type: 'text',
      pattern: '^[a-zA-Z0-9_]{1,32}$'
    },
    {
      name: 'dbUser',
      label: '数据库用户',
      defaultValue: 'wp_user',
      required: true,
      type: 'text',
      pattern: '^[a-zA-Z0-9_]{1,16}$'
    },
    {
      name: 'dbPassword',
      label: '数据库密码',
      defaultValue: 'ChangeMe123!',
      required: true,
      type: 'password',
      helpText: '建议 12+ 字符'
    },
    {
      name: 'siteTitle',
      label: '站点标题',
      defaultValue: '我的 WordPress 站点',
      required: true,
      type: 'text',
      helpText: '可后续在 WordPress 后台修改'
    },
    {
      name: 'adminUser',
      label: '管理员用户名',
      defaultValue: 'admin',
      required: true,
      type: 'text',
      pattern: '^[a-zA-Z0-9_]{3,16}$'
    },
    {
      name: 'adminPassword',
      label: '管理员密码',
      defaultValue: 'AdminPass123!',
      required: true,
      type: 'password',
      helpText: 'WordPress 要求至少 12 字符，包含字母数字'
    }
  ],
  steps: [
    {
      id: 'wp-1',
      description: '更新 apt 软件源',
      command: 'sudo apt update',
      risk: 'safe',
      rollback: null,
      estimatedSeconds: 10
    },
    {
      id: 'wp-2',
      description: '安装 LAMP 组件（Apache + MySQL + PHP）',
      command:
        'sudo DEBIAN_FRONTEND=noninteractive apt install -y apache2 mysql-server php libapache2-mod-php php-mysql php-gd php-mbstring php-xml php-cli php-curl',
      risk: 'medium',
      rollback:
        'sudo DEBIAN_FRONTEND=noninteractive apt remove -y apache2 mysql-server php libapache2-mod-php php-mysql',
      estimatedSeconds: 120
    },
    {
      id: 'wp-3',
      description: '启动并设置 Apache + MySQL 开机自启',
      command: 'sudo systemctl enable --now apache2 mysql',
      risk: 'medium',
      rollback: 'sudo systemctl disable --now apache2 mysql',
      estimatedSeconds: 5
    },
    {
      id: 'wp-4',
      description: '放行 Apache 防火墙端口',
      command: "sudo ufw allow 'Apache Full'",
      risk: 'high',
      rollback: "sudo ufw delete allow 'Apache Full'",
      estimatedSeconds: 2,
      requiresConfirm: true
    },
    {
      id: 'wp-5',
      description: '创建 WordPress 数据库与用户',
      command:
        "sudo mysql -e \"CREATE DATABASE IF NOT EXISTS ${dbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER IF NOT EXISTS '${dbUser}'@'localhost' IDENTIFIED BY '${dbPassword}'; GRANT ALL PRIVILEGES ON ${dbName}.* TO '${dbUser}'@'localhost'; FLUSH PRIVILEGES;\"",
      risk: 'medium',
      rollback:
        "sudo mysql -e \"DROP DATABASE IF EXISTS ${dbName}; DROP USER IF EXISTS '${dbUser}'@'localhost';\"",
      estimatedSeconds: 3
    },
    {
      id: 'wp-6',
      description: '下载并解压 WordPress',
      command:
        'cd /tmp && wget -q https://wordpress.org/latest.tar.gz && tar -xzf latest.tar.gz && sudo cp -a wordpress/. /var/www/html/ && sudo rm -f /var/www/html/index.html',
      risk: 'medium',
      rollback: 'sudo rm -rf /var/www/html/*',
      estimatedSeconds: 30
    },
    {
      id: 'wp-7',
      description: '生成 wp-config.php 并设置权限',
      command:
        "sudo cp /var/www/html/wp-config-sample.php /var/www/html/wp-config.php && sudo sed -i \"s/database_name_here/${dbName}/g; s/username_here/${dbUser}/g; s/password_here/${dbPassword}/g\" /var/www/html/wp-config.php && sudo chown -R www-data:www-data /var/www/html/ && sudo chmod -R 755 /var/www/html/",
      risk: 'medium',
      rollback: 'sudo rm -f /var/www/html/wp-config.php',
      estimatedSeconds: 3
    },
    {
      id: 'wp-8',
      description: '启用 Apache rewrite 模块并重启',
      command: 'sudo a2enmod rewrite && sudo systemctl restart apache2',
      risk: 'medium',
      rollback: 'sudo a2dismod rewrite && sudo systemctl restart apache2',
      estimatedSeconds: 3
    },
    {
      id: 'wp-9',
      description: '验证部署结果（HTTP 状态码）',
      command: "curl -s -o /dev/null -w 'WordPress 首页 HTTP %{http_code}\\n' http://127.0.0.1/",
      risk: 'safe',
      rollback: null,
      estimatedSeconds: 2
    }
  ]
}
