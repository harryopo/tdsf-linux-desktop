/**
 * 部署模板注册表
 *
 * 新增模板：在此文件中 import 并 push 到 ALL_TEMPLATES。
 */

import type { DeployTemplate } from '../types'
import { LAMP_TEMPLATE } from './lamp'
import { WORDPRESS_TEMPLATE } from './wordpress'
import { NGINX_PROXY_TEMPLATE } from './nginx-proxy'
import { DOCKER_TEMPLATE } from './docker'

/** 所有内置模板 */
export const ALL_TEMPLATES: DeployTemplate[] = [
  LAMP_TEMPLATE,
  WORDPRESS_TEMPLATE,
  NGINX_PROXY_TEMPLATE,
  DOCKER_TEMPLATE
]

/** 按 ID 查找模板 */
export function getTemplateById(id: string): DeployTemplate | undefined {
  return ALL_TEMPLATES.find((t) => t.id === id)
}
