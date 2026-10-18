/**
 * BootPage — 启动加载页（Shader 流光背景 + 可读前景），加载完自动进工作台
 *
 * 路由：/ 与 /boot
 *
 * 2026-10-17 简化成"纯加载态"（用户要求）：删掉「进入工作台」按钮、进度条与
 * 已保存服务器卡片，主进程把 boot 推到 done 且最短展示时长走完后自己跳去工作台。
 * 理由：这一页的职责只是"别让人对着白屏猜"，它不该再承担选择——
 * 选服务器在顶栏的下拉里、工作台空态里也有入口，启动页再摆一份就是三处同一个决定。
 *
 * 前景色不能用主题令牌：背景是本页自己画的暗纱（永远是深色），
 * 而 text-ink-strong 在浅色主题下是近黑——写在暗纱上等于看不见
 * （实测：浅色模式下标题就是黑压黑，用户截图里那块发白的卡片也是同一个原因，
 * 卡片用的 bg-sunken 在浅色主题下是 #e8e8e8）。所以这里固定用 --text-on-accent（两套主题都是白）。
 *
 * 工程侧保留：webglcontextlost 降级、GPU 上下文显式释放、IPC 阶段对接与补拉、
 * prefers-reduced-motion（关掉闪烁）、最短展示时长（避免一闪而过）。
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as THREE from 'three'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import type { BootLoadingStage } from '@shared/boot-types'

/** 全屏四边形顶点（兼容 Three r15x+ / WebGL2） */
const VERTEX_SHADER = /* glsl */ `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`

/**
 * 设计稿 boot.html 原版 fragment（r128 用 gl_FragColor）。
 * Three 0.185 默认 WebGL2 时仍可通过 glslVersion: GLSL1 跑通。
 *
 * 2026-10-18 收成单色相：原来 r/g/b 三条独立相位各积各的，屏幕上就是那道彩虹，
 * 而 PRODUCT.md 把"营销落地页式的启动页、彩虹光带当背景"明列为反例。
 * 现在三条相位收成一条亮度，色相由 brandColor 决定（取自 --accent-text，见下）。
 */
const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform vec2 resolution;
  uniform float time;
  uniform vec3 brandColor;

  void main(void) {
    vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);
    float t = time * 0.05;
    float lineWidth = 0.002;

    float glow = 0.0;
    for (int j = 0; j < 3; j++) {
      for (int i = 0; i < 5; i++) {
        float rawPhase = fract(t - 0.01 * float(j) + float(i) * 0.01);
        float easedPhase = mix(rawPhase, rawPhase * rawPhase * (3.0 - 2.0 * rawPhase), 0.6);
        glow += lineWidth * float(i * i) / abs(easedPhase * 5.0 - length(uv) + mod(uv.x + uv.y, 0.2));
      }
    }

    // 指数收束：亮度单调升到 brandColor 为止，色相全程不变——
    // 既不会冲到白芯，也不会像逐通道截断那样偏到青/橙上去。
    vec3 color = brandColor * (1.0 - exp(-glow * 1.8));
    gl_FragColor = vec4(color, 1.0);
  }
`

/**
 * 从 CSS 令牌读品牌蓝，交给 shader 当色相。
 * 读不到返回 null，shader 那边退回白：黑白蓝里"白"不算跑偏，彩虹才算。
 * 这里不许出现颜色字面量——色值的唯一来源是 ui-tokens.css 的 --accent-text。
 */
export function brandColorFromToken(cssValue: string): [number, number, number] | null {
  const m = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(cssValue.trim())
  if (!m) return null
  const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  const n = parseInt(hex, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** 主进程没推消息时的兜底文案 */
const DEFAULT_MESSAGE = '正在启动'
/** 最短展示时长：够读完一行字，又不让人干等 */
const MIN_VISIBLE_MS = 1200

/** BootPage 启动加载页 */
export function BootPage() {
  const navigate = useNavigate()
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const [message, setMessage] = useState(DEFAULT_MESSAGE)
  const [bootDone, setBootDone] = useState(false)
  const [minElapsed, setMinElapsed] = useState(false)
  const [webglFailed, setWebglFailed] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const ready = bootDone && minElapsed

  // 监听主进程加载阶段；订阅前先补拉一次（主进程 init 常常早于本页挂载，
  // done 推过来时没有订阅者就会永远停在"正在启动"，也就永远不会自动进工作台）。
  useEffect(() => {
    if (!isElectronAPIAvailable() || !window.electronAPI?.onBootLoadingStage) {
      setBootDone(true)
      setMessage('准备就绪')
      return
    }

    const apply = (payload: BootLoadingStage) => {
      if (payload.message) setMessage(payload.message)
      if (payload.stage === 'done') {
        setBootDone(true)
        setMessage('准备就绪')
      }
    }

    const unsubscribe = window.electronAPI.onBootLoadingStage(apply)
    void window.electronAPI.bootGetState?.().then((last) => last && apply(last))
    return unsubscribe
  }, [])

  // Three.js shader 背景
  useEffect(() => {
    const container = canvasHostRef.current
    if (!container) return

    let disposed = false
    let renderer: THREE.WebGLRenderer | null = null
    let animationId = 0
    let geometry: THREE.PlaneGeometry | null = null
    let material: THREE.ShaderMaterial | null = null
    let canvas: HTMLCanvasElement | null = null
    let handleContextLost: ((event: Event) => void) | null = null

    try {
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
      const scene = new THREE.Scene()
      geometry = new THREE.PlaneGeometry(2, 2)
      // 光带的色相不写死在代码里：读当前主题的 --accent-text，换主题/换令牌它就跟着走
      const brand = brandColorFromToken(
        getComputedStyle(document.documentElement).getPropertyValue('--accent-text')
      )
      const brandColor = brand ? new THREE.Color(brand[0], brand[1], brand[2]) : new THREE.Color(1, 1, 1)
      const uniforms = {
        time: { value: 1.0 },
        resolution: { value: new THREE.Vector2(1, 1) },
        brandColor: { value: brandColor },
      }
      material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        glslVersion: THREE.GLSL1,
      })
      scene.add(new THREE.Mesh(geometry, material))

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.setClearColor(0x000000, 1)
      canvas = renderer.domElement
      canvas.style.display = 'block'
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      container.appendChild(canvas)

      handleContextLost = (event: Event) => {
        event.preventDefault()
        setWebglFailed(true)
      }
      canvas.addEventListener('webglcontextlost', handleContextLost)

      const onResize = () => {
        if (!renderer || !container) return
        renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight, false)
        uniforms.resolution.value.x = renderer.domElement.width
        uniforms.resolution.value.y = renderer.domElement.height
      }
      onResize()
      window.addEventListener('resize', onResize)

      const animate = () => {
        if (disposed || !renderer) return
        animationId = window.requestAnimationFrame(animate)
        uniforms.time.value += 0.05
        renderer.render(scene, camera)
      }
      animate()

      return () => {
        disposed = true
        window.cancelAnimationFrame(animationId)
        window.removeEventListener('resize', onResize)
        if (canvas && handleContextLost) canvas.removeEventListener('webglcontextlost', handleContextLost)
        renderer?.forceContextLoss()
        geometry?.dispose()
        material?.dispose()
        renderer?.dispose()
        if (canvas && canvas.parentNode === container) container.removeChild(canvas)
      }
    } catch (err) {
      console.error('[BootPage] WebGL shader 初始化失败，回退纯黑底:', err)
      setWebglFailed(true)
    }
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // 最短展示时长用 setTimeout：窗口被遮挡时 RAF 停摆，数帧会永远走不完
  useEffect(() => {
    if (reducedMotion) {
      setMinElapsed(true)
      return
    }
    const t = window.setTimeout(() => setMinElapsed(true), MIN_VISIBLE_MS)
    return () => window.clearTimeout(t)
  }, [reducedMotion])

  // 加载完自己走，不等人来点：这一页没有别的用途
  useEffect(() => {
    if (!ready) return
    navigate('/workbench', { replace: true })
  }, [ready, navigate])

  return (
    <main
      data-viewport-mode="app-shell"
      className="relative h-screen w-screen overflow-hidden bg-canvas"
      aria-label="TDSF Linux 运维助手 启动加载"
    >
      <div
        ref={canvasHostRef}
        className="absolute inset-0 z-0 overflow-hidden bg-canvas"
        aria-hidden="true"
      />
      {webglFailed && (
        <div
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{
            background: 'radial-gradient(ellipse at 50% 40%, var(--bg-tertiary) 0%, var(--bg-primary) 70%)',
          }}
        />
      )}
      {/* 暗纱：字永远落在够暗的底上，光带只在边缘露出来。没有这层，白字压白光必然读不清 */}
      <div
        className="pointer-events-none absolute inset-0 z-[2]"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(ellipse 62% 52% at 50% 50%, rgba(0,0,0,0.86) 0%, rgba(0,0,0,0.62) 55%, rgba(0,0,0,0.18) 100%)',
        }}
      />

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-7">
        <h1
          className="text-center text-splash font-semibold text-(--text-on-accent)"
          style={{ letterSpacing: '0.18em', textIndent: '0.18em' }}
        >
          TDSF LINUX
        </h1>

        {/*
          加载态一行：主进程推到哪一步就写哪一步，末尾一个闪烁的块状光标（终端的味道）。
          prefers-reduced-motion 下不闪，文案照旧更新。
          颜色固定用 --text-on-accent（两套主题都是白）：背景是本页自己画的暗纱，
          跟主题走会在浅色模式下变成"黑压黑"。
        */}
        <p
          data-dom-id="boot-loading"
          role="status"
          aria-live="polite"
          className="flex items-center gap-1.5 font-mono text-caption opacity-70 text-(--text-on-accent)"
        >
          <span>{message}</span>
          <span
            aria-hidden="true"
            className={
              'inline-block h-3.5 w-[7px] bg-(--text-on-accent) ' +
              (reducedMotion ? '' : 'animate-pulse')
            }
          />
        </p>
      </div>
    </main>
  )
}

export default BootPage
