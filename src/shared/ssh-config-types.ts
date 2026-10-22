/**
 * ~/.ssh/config 导入的共享形状
 *
 * 只带非敏感字段：主机、端口、用户、密钥路径与跳板机字符串。
 * 文件原文不跨进程；口令/私钥内容更不会出现在这里。
 */
export interface SshConfigHost {
  /** Host 行里的别名（也是导入后的显示名） */
  alias: string
  /** 实际主机名（HostName，缺省等于 alias） */
  host: string
  port: number
  username: string
  /** 展开 ~ 之后的私钥绝对路径 */
  identityFile?: string
  /** ProxyJump 原文；当前版本不导入跳板机，只作为提示 */
  proxyJump?: string
}

export interface SshConfigScanResult {
  ok: boolean
  /** 实际读取的配置文件路径（仅用于界面说明，不接受渲染层传路径） */
  path?: string
  hosts: SshConfigHost[]
  /** 跳过的语法与原因（通配 Host、Match、Include、ProxyJump…） */
  warnings: string[]
  error?: string
}
