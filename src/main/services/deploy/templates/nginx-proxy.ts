/**
 * Nginx 反向代理 + HTTPS 部署模板
 *
 * 数据源：Nginx 官方文档 + Let's Encrypt
 * License：BSD-like
 * 测试环境：Ubuntu 22.04 / CentOS Stream 9
 */

import type { DeployTemplate } from '../types'

/** Nginx 反向代理模板 */
export const NGINX_PROXY_TEMPLATE: DeployTemplate = {
  id: 'nginx-proxy',
  name: 'Nginx 反向代理',
  summary: '部署 Nginx + HTTPS（Let\'s Encrypt），反向代理到后端应用',
  category: 'proxy',
  difficulty: 2,
  tutorialId: 'tut-nginx-reverse-proxy',
  source: 'Nginx 官方文档',
  estimatedMinutes: 7,
  supportedDistros: ['ubuntu', 'debian', 'rhel', 'centos', 'rocky'],
  variables: [
    {
      name: 'domain',
      label: '域名',
      defaultValue: 'app.example.com',
      placeholder: 'your-domain.com',
      required: true,
      type: 'domain',
      pattern: '^[a-zA-Z0-9][a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
      helpText: '需提前将 DNS A 记录指向本机 IP'
    },
    {
      name: 'backendUrl',
      label: '后端地址',
      defaultValue: 'http://127.0.0.1:3000',
      placeholder: 'http://127.0.0.1:3000',
      required: true,
      type: 'text',
      pattern: '^https?://[\\w.-]+:\\d+$'
    },
    {
      name: 'adminEmail',
      label: '管理员邮箱',
      defaultValue: '[email protected]',
      required: true,
      type: 'text',
      pattern: '^[\\w.-]+@[\\w.-]+\\.\\w+$',
      helpText: '用于 Let\'s Encrypt 证书注册'
    }
  ],
  steps: [
    {
      id: 'ngx-1',
      description: '安装 Nginx',
      command:
        'if command -v apt >/dev/null 2>&1; then sudo apt install -y nginx; else sudo dnf install -y nginx; fi',
      risk: 'medium',
      rollback: 'if command -v apt >/dev/null 2>&1; then sudo apt remove -y nginx; else sudo dnf remove -y nginx; fi',
      estimatedSeconds: 30
    },
    {
      id: 'ngx-2',
      description: '启动并设置 Nginx 开机自启',
      command: 'sudo systemctl enable --now nginx',
      risk: 'medium',
      rollback: 'sudo systemctl disable --now nginx',
      estimatedSeconds: 3
    },
    {
      id: 'ngx-3',
      description: '放行 HTTP/HTTPS 端口',
      command:
        'if command -v ufw >/dev/null 2>&1; then sudo ufw allow "Nginx Full"; else sudo firewall-cmd --permanent --add-service=http && sudo firewall-cmd --permanent --add-service=https && sudo firewall-cmd --reload; fi',
      risk: 'high',
      rollback:
        'if command -v ufw >/dev/null 2>&1; then sudo ufw delete allow "Nginx Full"; else sudo firewall-cmd --permanent --remove-service=http && sudo firewall-cmd --permanent --remove-service=https && sudo firewall-cmd --reload; fi',
      estimatedSeconds: 3,
      requiresConfirm: true
    },
    {
      id: 'ngx-4',
      description: '写入反向代理配置',
      command:
        "sudo tee /etc/nginx/conf.d/${domain}.conf > /dev/null << 'NGINX_EOF'\nserver {\n    listen 80;\n    server_name ${domain};\n\n    location / {\n        proxy_pass ${backendUrl};\n        proxy_http_version 1.1;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }\n}\nNGINX_EOF",
      risk: 'medium',
      rollback: "sudo rm -f /etc/nginx/conf.d/${domain}.conf",
      estimatedSeconds: 2
    },
    {
      id: 'ngx-5',
      description: '测试配置并重载 Nginx',
      command: 'sudo nginx -t && sudo systemctl reload nginx',
      risk: 'medium',
      rollback: null,
      estimatedSeconds: 3
    },
    {
      id: 'ngx-6',
      description: '安装 certbot 并申请 Let\'s Encrypt 证书',
      command:
        'if command -v apt >/dev/null 2>&1; then sudo apt install -y certbot python3-certbot-nginx; else sudo dnf install -y certbot python3-certbot-nginx; fi && sudo certbot --nginx -d ${domain} --non-interactive --agree-tos -m ${adminEmail}',
      risk: 'high',
      rollback: "sudo certbot delete --cert-name ${domain}",
      estimatedSeconds: 60,
      requiresConfirm: true
    }
  ]
}
