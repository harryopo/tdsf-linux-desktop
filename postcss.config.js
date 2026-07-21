/**
 * PostCSS 配置 — Tailwind CSS v4 接入
 *
 * 说明：
 * - Tailwind v4 通过 @tailwindcss/postcss 插件接入
 * - autoprefixer 由 Tailwind v4 内置，无需额外启用
 * - 与 AntD 5 共存：Tailwind preflight 默认开启，需通过 @layer 调整优先级
 */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
