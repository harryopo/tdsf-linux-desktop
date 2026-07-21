/**
 * logger.ts：极简 logger 封装
 * v1.0 阶段避免引入 winston/pino 等依赖，用 console 即可
 */
const isDev = process.env.NODE_ENV !== 'production'

function format(level: string, msg: string): string {
  const time = new Date().toISOString()
  return `[${time}] [${level}] ${msg}`
}

export const logger = {
  info: (msg: string) => isDev && console.log(format('INFO', msg)),
  warn: (msg: string) => console.warn(format('WARN', msg)),
  error: (msg: string) => console.error(format('ERROR', msg)),
  debug: (msg: string) => isDev && console.log(format('DEBUG', msg)),
}
