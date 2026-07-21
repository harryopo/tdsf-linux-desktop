/**
 * LAMP 部署模板（Linux + Apache + MariaDB + PHP）
 *
 * 数据源：Red Hat 官方文档（docs.redhat.com）+ 内部测试
 * License：CC BY-SA 4.0
 * 测试环境：CentOS Stream 9 / RHEL 9
 *
 * 注意：本模板默认使用 dnf（RHEL 8+/CentOS Stream）。
 * Ubuntu 用户应改用 wordpress 模板或自定义变量。
 */

import type { DeployTemplate } from '../types'

/** LAMP 部署模板 */
export const LAMP_TEMPLATE: DeployTemplate = {
  id: 'lamp',
  name: 'LAMP 部署',
  summary: '在 CentOS/RHEL 上一键部署 Apache + MariaDB + PHP 经典 Web 运行环境',
  category: 'web-server',
  difficulty: 2,
  tutorialId: 'tut-lamp-centos',
  source: 'Red Hat 官方文档',
  estimatedMinutes: 8,
  supportedDistros: ['rhel', 'centos', 'rocky', 'fedora'],
  variables: [
    {
      name: 'dbName',
      label: '数据库名',
      defaultValue: 'myapp_db',
      placeholder: 'myapp_db',
      required: true,
      type: 'text',
      pattern: '^[a-zA-Z0-9_]{1,32}$',
      helpText: '仅允许字母数字下划线，长度 1-32'
    },
    {
      name: 'dbUser',
      label: '数据库用户',
      defaultValue: 'app_user',
      placeholder: 'app_user',
      required: true,
      type: 'text',
      pattern: '^[a-zA-Z0-9_]{1,16}$'
    },
    {
      name: 'dbPassword',
      label: '数据库密码',
      defaultValue: 'ChangeMe123!',
      placeholder: '请输入强密码',
      required: true,
      type: 'password',
      helpText: '建议 12+ 字符，包含大小写数字'
    },
    {
      name: 'phpPort',
      label: 'Apache 监听端口',
      defaultValue: '80',
      required: true,
      type: 'port',
      helpText: '默认 80，如需修改请同步调整防火墙'
    }
  ],
  steps: [
    {
      id: 'lamp-1',
      description: '更新系统软件包索引',
      command: 'sudo dnf check-update',
      risk: 'safe',
      rollback: null,
      estimatedSeconds: 5
    },
    {
      id: 'lamp-2',
      description: '安装 Apache httpd、PHP 及常用扩展',
      command:
        'sudo dnf install -y httpd php php-mysqlnd php-gd php-mbstring php-xml php-cli',
      risk: 'medium',
      rollback: 'sudo dnf remove -y httpd php php-mysqlnd php-gd php-mbstring php-xml php-cli',
      estimatedSeconds: 60
    },
    {
      id: 'lamp-3',
      description: '安装并启动 MariaDB',
      command: 'sudo dnf install -y mariadb-server mariadb && sudo systemctl enable --now mariadb',
      risk: 'medium',
      rollback: 'sudo systemctl disable --now mariadb && sudo dnf remove -y mariadb-server mariadb',
      estimatedSeconds: 45
    },
    {
      id: 'lamp-4',
      description: '启动 Apache 并设置开机自启',
      command: 'sudo systemctl enable --now httpd',
      risk: 'medium',
      rollback: 'sudo systemctl disable --now httpd',
      estimatedSeconds: 3
    },
    {
      id: 'lamp-5',
      description: '放行 HTTP/HTTPS 端口（防火墙）',
      command:
        'sudo firewall-cmd --permanent --add-service=http && sudo firewall-cmd --permanent --add-service=https && sudo firewall-cmd --reload',
      risk: 'high',
      rollback:
        'sudo firewall-cmd --permanent --remove-service=http && sudo firewall-cmd --permanent --remove-service=https && sudo firewall-cmd --reload',
      estimatedSeconds: 3,
      requiresConfirm: true
    },
    {
      id: 'lamp-6',
      description: '创建应用数据库与用户',
      command:
        "sudo mysql -e \"CREATE DATABASE IF NOT EXISTS ${dbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER IF NOT EXISTS '${dbUser}'@'localhost' IDENTIFIED BY '${dbPassword}'; GRANT ALL PRIVILEGES ON ${dbName}.* TO '${dbUser}'@'localhost'; FLUSH PRIVILEGES;\"",
      risk: 'medium',
      rollback:
        "sudo mysql -e \"DROP DATABASE IF EXISTS ${dbName}; DROP USER IF EXISTS '${dbUser}'@'localhost';\"",
      estimatedSeconds: 3
    },
    {
      id: 'lamp-7',
      description: '配置 PHP 时区为中国上海',
      command:
        "sudo bash -c 'echo \"date.timezone = Asia/Shanghai\" > /etc/php.d/99-timezone.ini'",
      risk: 'low',
      rollback: 'sudo rm -f /etc/php.d/99-timezone.ini',
      estimatedSeconds: 1
    },
    {
      id: 'lamp-8',
      description: '写入 PHP 测试页并验证',
      command:
        "echo '<?php phpinfo(); ?>' | sudo tee /var/www/html/info.php > /dev/null && sudo systemctl restart httpd && curl -s -o /dev/null -w 'HTTP %{http_code}\\n' http://127.0.0.1:${phpPort}/info.php",
      risk: 'low',
      rollback: 'sudo rm -f /var/www/html/info.php',
      estimatedSeconds: 3
    }
  ]
}
