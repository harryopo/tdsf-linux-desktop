/**
 * Docker + Docker Compose 部署模板
 *
 * 数据源：Docker 官方文档
 * License：Apache 2.0
 * 测试环境：Ubuntu 22.04 / CentOS Stream 9
 */

import type { DeployTemplate } from '../types'

/** Docker 部署模板 */
export const DOCKER_TEMPLATE: DeployTemplate = {
  id: 'docker',
  name: 'Docker 容器化运行时',
  summary: '一键安装 Docker Engine + Docker Compose，并配置免 sudo 使用',
  category: 'containers',
  difficulty: 1,
  tutorialId: 'tut-docker-basics',
  source: 'Docker 官方文档',
  estimatedMinutes: 5,
  supportedDistros: ['ubuntu', 'debian', 'rhel', 'centos', 'rocky', 'fedora'],
  variables: [
    {
      name: 'dockerUser',
      label: '免 sudo 用户',
      defaultValue: '$USER',
      placeholder: '留空则用当前用户',
      required: false,
      type: 'text',
      helpText: '将其加入 docker 组以免 sudo'
    },
    {
      name: 'registryMirror',
      label: '镜像加速器',
      defaultValue: 'https://docker.mirrors.ustc.edu.cn',
      placeholder: 'https://docker.mirrors.ustc.edu.cn',
      required: false,
      type: 'text',
      helpText: '国内服务器推荐配置；海外可留空'
    }
  ],
  steps: [
    {
      id: 'dk-1',
      description: '卸载旧版本（如果有）',
      command:
        'if command -v apt >/dev/null 2>&1; then sudo apt remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true; else sudo dnf remove -y docker docker-client docker-client-latest docker-common docker-latest docker-engine 2>/dev/null || true; fi',
      risk: 'low',
      rollback: null,
      estimatedSeconds: 5
    },
    {
      id: 'dk-2',
      description: '安装 Docker 依赖与官方源',
      command:
        'if command -v apt >/dev/null 2>&1; then sudo apt update && sudo DEBIAN_FRONTEND=noninteractive apt install -y ca-certificates curl gnupg && sudo install -m 0755 -d /etc/apt/keyrings && curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes && sudo chmod a+r /etc/apt/keyrings/docker.gpg && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null && sudo apt update; else sudo dnf install -y dnf-plugins-core && sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo; fi',
      risk: 'medium',
      rollback: 'sudo rm -f /etc/apt/sources.list.d/docker.list /etc/yum.repos.d/docker-ce.repo',
      estimatedSeconds: 30
    },
    {
      id: 'dk-3',
      description: '安装 Docker Engine + Compose',
      command:
        'if command -v apt >/dev/null 2>&1; then sudo DEBIAN_FRONTEND=noninteractive apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin; else sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin; fi',
      risk: 'medium',
      rollback:
        'if command -v apt >/dev/null 2>&1; then sudo DEBIAN_FRONTEND=noninteractive apt remove -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin; else sudo dnf remove -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin; fi',
      estimatedSeconds: 90
    },
    {
      id: 'dk-4',
      description: '启动并设置 Docker 开机自启',
      command: 'sudo systemctl enable --now docker',
      risk: 'medium',
      rollback: 'sudo systemctl disable --now docker',
      estimatedSeconds: 3
    },
    {
      id: 'dk-5',
      description: '将当前用户加入 docker 组（免 sudo）',
      command: 'sudo usermod -aG docker ${dockerUser} && newgrp docker',
      risk: 'medium',
      rollback: "sudo gpasswd -d ${dockerUser} docker",
      estimatedSeconds: 2
    },
    {
      id: 'dk-6',
      description: '配置镜像加速器（国内服务器）',
      command:
        "if [ -n \"${registryMirror}\" ]; then sudo mkdir -p /etc/docker && sudo tee /etc/docker/daemon.json > /dev/null << EOF\n{\n  \"registry-mirrors\": [\"${registryMirror}\"]\n}\nEOF\nsudo systemctl restart docker; fi",
      risk: 'medium',
      rollback: 'sudo rm -f /etc/docker/daemon.json && sudo systemctl restart docker',
      estimatedSeconds: 3
    },
    {
      id: 'dk-7',
      description: '验证 Docker 安装（运行 hello-world）',
      command: 'sudo docker run --rm hello-world',
      risk: 'safe',
      rollback: null,
      estimatedSeconds: 15
    }
  ]
}
