/**
 * BootPage — 启动加载页（Shader 流光背景 + 可读前景）
 *
 * 路由：/ 与 /boot
 *
 * 2026-10-05 重做前景（用户选定：保留启动页，只修可读性）：
 * - 旧版文字直接压在 shader 光带上，"系统初始化中…"实测对比度 1.06:1，等于看不见；
 *   现在 shader 与文字之间固定加一层暗纱，文字永远落在 ≥#1e1e1e 的底上。
 * - 颜色全部走 ui 令牌单源，不再引用 --trae-* 旧层，也不再混用第二套字体族。
 * - 进度条给出真实阶段文案（主进程 IPC 推什么就显示什么）与百分比；
 *   旧版把阶段消息丢掉、写死"系统初始化中…"，用户不知道卡在哪。
 * - 按钮改成实底主操作色，去掉玻璃拟态 + 外发光 + 3.5s 才浮现的入场编排
 *   （那是营销 splash 的做法，工具软件不该让人等动画播完才看到能点的东西）。
 *
 * 工程侧保留：webglcontextlost 降级、GPU 上下文显式释放、IPC 进度对接与补拉、
 * prefers-reduced-motion、3.5s 最小展示时长（避免一闪而过）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as THREE from 'three'
import { ArrowRight, Loader2, Server } from 'lucide-react'
import { isElectronAPIAvailable } from '@/utils/electron-api'
import { useServerStore } from '@/stores/server-store'
import { useServerConnect } from '@/hooks/useServerConnect'

/** 全屏四边形顶点（兼容 Three r15x+ / WebGL2） */
const VERTEX_SHADER = /* glsl */ `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`

/**
 * 设计稿 boot.html 原版 fragment（r128 用 gl_FragColor）。
 * Three 0.185 默认 WebGL2 时仍可通过 glslVersion: GLSL1 跑通。
 */
const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform vec2 resolution;
  uniform float time;

  void main(void) {
    vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);
    float t = time * 0.05;
    float lineWidth = 0.002;

    vec3 color = vec3(0.0);
    for (int j = 0; j < 3; j++) {
      for (int i = 0; i < 5; i++) {
        float rawPhase = fract(t - 0.01 * float(j) + float(i) * 0.01);
        float easedPhase = mix(rawPhase, rawPhase * rawPhase * (3.0 - 2.0 * rawPhase), 0.6);
        color[j] += lineWidth * float(i * i) / abs(easedPhase * 5.0 - length(uv) + mod(uv.x + uv.y, 0.2));
      }
    }

    gl_FragColor = vec4(color[0], color[1], color[2], 1.0);
  }
`

/** 主进程没推消息时的兜底文案 */
const DEFAULT_MESSAGE = '正在启动…'
/** 最短展示时长：够读完一行字，又不让人干等 */
const MIN_VISIBLE_MS = 1200

/** BootPage 启动加载页 */
export function BootPage() {
  const navigate = useNavigate()
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState(DEFAULT_MESSAGE)
  const [bootDone, setBootDone] = useState(false)
  const [minElapsed, setMinElapsed] = useState(false)
  const [webglFailed, setWebglFailed] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const loaded = bootDone && minElapsed
  const servers = useServerStore((s) => s.servers)
  /** 连接走与工作台顶栏同一份实现；连上（或切到已有会话）就直接进工作台 */
  const { connectingId, connectSavedServer } = useServerConnect({
    onConnected: () => navigate('/workbench', { replace: true }),
  })

  // 监听主进程加载阶段；订阅前先补拉一次（主进程 init 常常早于本页挂载，
  // done 推过来时没有订阅者就会永久停在"正在启动…"）。
  useEffect(() => {
    if (!isElectronAPIAvailable() || !window.electronAPI?.onBootLoadingStage) {
      setBootDone(true)
      setMessage('就绪 · 点击进入工作台')
      return
    }

    const apply = (payload: { stage: string; progress: number; message: string }) => {
      setProgress((prev) => Math.max(prev, payload.progress))
      if (payload.message) setMessage(payload.message)
      if (payload.stage === 'done') setBootDone(true)
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
      const uniforms = { time: { value: 1.0 }, resolution: { value: new THREE.Vector2(1, 1) } }
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
      setProgress(100)
      setMinElapsed(true)
      return
    }
    const t = window.setTimeout(() => setMinElapsed(true), MIN_VISIBLE_MS)
    return () => window.clearTimeout(t)
  }, [reducedMotion])

  // 进度条：真实阶段为准，时间只做视觉补齐（阶段推得比 3s 快时不硬等）
  useEffect(() => {
    if (reducedMotion) return
    const startAt = Date.now()
    let rafId = 0
    const tick = () => {
      const t = Math.min((Date.now() - startAt) / 2000, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setProgress((prev) => Math.max(prev, Math.round(eased * 90)))
      if (t >= 1) return
      rafId = window.requestAnimationFrame(tick)
    }
    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [reducedMotion])

  const handleEnter = useCallback(() => {
    if (!loaded) return
    navigate('/workbench', { replace: true })
  }, [loaded, navigate])

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
          className="text-center text-splash font-semibold text-ink-strong"
          style={{ letterSpacing: '0.18em', textIndent: '0.18em' }}
        >
          TDSF LINUX
        </h1>

        <button
          type="button"
          data-dom-id="boot-enter"
          aria-label="进入工作台"
          disabled={!loaded}
          onClick={handleEnter}
          className={
            'pointer-events-auto inline-flex h-10 items-center gap-2 rounded-(--ui-radius-card) px-6 ' +
            'text-md font-medium transition-colors duration-[var(--ui-dur-fast)] ' +
            (loaded
              ? 'bg-accent-solid text-(--text-on-accent) hover:bg-accent-solid-hover active:bg-accent-solid-active'
              : 'cursor-default border border-line-strong bg-sunken text-ink-mute')
          }
        >
          <span>{loaded ? '进入工作台' : '准备中'}</span>
          {loaded && <ArrowRight className="size-4" aria-hidden="true" />}
        </button>

        <div
          className="flex w-[260px] max-w-[80vw] flex-col gap-2"
          role="status"
          aria-live="polite"
        >
          <div
            className="h-1 w-full overflow-hidden rounded-full bg-sunken ring-1 ring-line-strong"
            role="progressbar"
            aria-label="加载进度"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-accent-solid transition-[width] duration-[var(--ui-dur-base)] ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex items-baseline justify-between gap-3 text-caption">
            <span className="text-ink-dim">{message}</span>
            <span className="shrink-0 tabular-nums text-ink-strong">{progress}%</span>
          </div>
        </div>

        {/*
          * 已保存服务器的快速连接：以前启动页对"上一台机器"一无所知，
          * 每次进来都要先点进工作台、再在顶栏菜单里挑一台。数据在 App 挂载时
          * 就从主进程 hydrate 好了，这里只做选择与发起，连接本身走 useServerConnect
          * （与顶栏同一份实现）。启动没走完不摆出来——那时点了也是报错。
          */
        loaded && isElectronAPIAvailable() ? (
          <section
            className="pointer-events-auto flex w-[340px] max-w-[86vw] flex-col gap-2 rounded-(--ui-radius-card) border border-line-strong bg-sunken p-3"
            aria-label="已保存的服务器"
          >
            <h2 className="text-md font-semibold text-ink-strong">已保存的服务器</h2>
            {servers.length === 0 ? (
              <p className="text-caption text-ink-dim">
                还没有保存过服务器。进入工作台后可以在「SSH 连接」里添加一台。
              </p>
            ) : (
              <>
                <ul className="flex flex-col gap-1">
                  {servers.slice(0, 5).map((srv) => {
                    const busy = connectingId === srv.id
                    return (
                      <li key={srv.id}>
                        <button
                          type="button"
                          data-dom-id="boot-quick-connect"
                          aria-label={`连接 ${srv.name || srv.host}`}
                          disabled={connectingId !== null}
                          onClick={() => void connectSavedServer(srv)}
                          className={
                            'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left ' +
                            'transition-colors duration-[var(--ui-dur-fast)] ' +
                            (connectingId !== null && !busy
                              ? 'cursor-default'
                              : 'hover:bg-hover')
                          }
                        >
                          {busy ? (
                            <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
                          ) : (
                            <Server className="size-3.5 shrink-0 text-ink-mute" aria-hidden="true" />
                          )}
                          <span className="min-w-0 flex-1 truncate text-md text-ink-strong">
                            {srv.name || srv.host}
                          </span>
                          <span className="shrink-0 font-mono text-caption text-ink-mute">
                            {srv.username}@{srv.host}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                <p className="text-caption text-ink-mute">
                  点一下直接连上并进工作台；一台机器最多列一次，已连过的会切过去。
                </p>
              </>
            )}
          </section>
        ) : null}
      </div>
    </main>
  )
}

export default BootPage
