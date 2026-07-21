/**
 * BootPage — Shader 动画启动页（1:1 复刻 tdsf-linux-redesign/pages/boot.html）
 *
 * // @ai-session: ai-20260721-boot
 * // @ai-task: Task-2.1 boot-page 1:1 复刻
 *
 * 路由：/ 与 /boot
 * 设计稿：tdsf-linux-redesign/pages/boot.html
 *
 * 视觉：
 * - 纯黑底 (var(--trae-shader-bg)) + Three.js 全屏 fragment shader 流光
 * - 居中大标题 TDSF LINUX (var(--trae-font-family-heading))
 * - 进度条 280×2px (var(--trae-bg-brand))，3s 填充
 * - 状态文字「正在加载运维内核...」→「就绪 · 点击进入工作台」
 * - 「进入工作台」按钮 (data-dom-id="boot-enter"，var(--trae-bg-brand) 实色)
 * - 底部版本信息「v2.0 · 2026 火山杯 Agent 创新大赛」(12px var(--trae-text-tertiary))
 * - prefers-reduced-motion: 禁用 UI 动画，shader 保留
 *
 * SubTasks:
 * - 2.1.1 Three.js shader 动画 ✅
 * - 2.1.2 标题 + 按钮 (boot-enter) ✅
 * - 2.1.3 进度条 + 状态文字 ✅
 * - 2.1.4 底部版本信息 ✅
 * - 2.1.5 prefers-reduced-motion 支持 ✅
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as THREE from 'three'
import { ArrowRight } from 'lucide-react'

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

const PROGRESS_DURATION_MS = 3000
const PROGRESS_DELAY_MS = 500
const BOOT_VERSION_TEXT = 'v2.0 · 2026 火山杯 Agent 创新大赛'

/** BootPage Shader 启动加载页 */
export function BootPage() {
  const navigate = useNavigate()
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [webglFailed, setWebglFailed] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const timersRef = useRef<number[]>([])

  // Three.js shader 背景（SubTask 2.1.1）
  useEffect(() => {
    const container = canvasHostRef.current
    if (!container) return

    let disposed = false
    let renderer: THREE.WebGLRenderer | null = null
    let animationId = 0

    try {
      // 全屏 shader 四边形用正交相机（避免新版 three 对裸 Camera 的差异）
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

      const scene = new THREE.Scene()
      const geometry = new THREE.PlaneGeometry(2, 2)
      const uniforms = {
        time: { value: 1.0 },
        resolution: { value: new THREE.Vector2(1, 1) },
      }

      const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        // 强制 GLSL1，保留设计稿 gl_FragColor 写法
        glslVersion: THREE.GLSL1,
      })

      const mesh = new THREE.Mesh(geometry, material)
      scene.add(mesh)

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.setClearColor(0x000000, 1)
      const canvas = renderer.domElement
      canvas.style.display = 'block'
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      container.appendChild(canvas)

      const onResize = () => {
        if (!renderer || !container) return
        const width = container.clientWidth || window.innerWidth
        const height = container.clientHeight || window.innerHeight
        renderer.setSize(width, height, false)
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
        geometry.dispose()
        material.dispose()
        renderer?.dispose()
        if (canvas.parentNode === container) {
          container.removeChild(canvas)
        }
      }
    } catch (err) {
      console.error('[BootPage] WebGL shader 初始化失败，回退纯黑底:', err)
      setWebglFailed(true)
    }
  }, [])

  // prefers-reduced-motion JS 判断（SubTask 2.1.5）
  // shader 核心视觉保留，仅用 JS 状态控制 UI 进度条是否走动画
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // 进度条 0 → 100（约 3s，与设计稿一致）
  useEffect(() => {
    if (reducedMotion) {
      // 减少动效：跳过 3s 动画，直接进入就绪态
      setProgress(100)
      setLoaded(true)
      return
    }
    const startAt = Date.now() + PROGRESS_DELAY_MS
    const id = window.setInterval(() => {
      const now = Date.now()
      if (now < startAt) return
      const t = Math.min((now - startAt) / PROGRESS_DURATION_MS, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setProgress(Math.round(eased * 100))
      if (t >= 1) {
        window.clearInterval(id)
        setLoaded(true)
      }
    }, 30)
    timersRef.current.push(id)

    return () => {
      timersRef.current.forEach((t) => {
        window.clearTimeout(t)
        window.clearInterval(t)
      })
      timersRef.current = []
    }
  }, [reducedMotion])

  const handleEnter = useCallback(() => {
    if (!loaded) return
    timersRef.current.forEach((t) => {
      window.clearTimeout(t)
      window.clearInterval(t)
    })
    navigate('/workbench', { replace: true })
  }, [loaded, navigate])

  return (
    <main
      data-viewport-mode="app-shell"
      className="relative h-screen w-screen overflow-hidden"
      style={{ background: 'var(--trae-shader-bg)' }}
      aria-label="TDSF Linux 运维助手 启动加载"
    >
      {/* Shader 背景（SubTask 2.1.1） */}
      <div
        ref={canvasHostRef}
        className="absolute inset-0 z-0 overflow-hidden"
        style={{ background: 'var(--trae-shader-bg)' }}
        aria-hidden
      />
      {webglFailed && (
        <div
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{
            background:
              'radial-gradient(ellipse at 50% 40%, var(--trae-status-primary-surface-l3) 0%, var(--trae-shader-bg) 70%)',
          }}
        />
      )}

      {/* 前景：居中标题 + 按钮 + 进度（SubTask 2.1.2 / 2.1.3） */}
      <div
        className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center"
        style={{ paddingBottom: '4vh' }}
      >
        <h1
          className="boot-title whitespace-nowrap text-center text-7xl font-semibold"
          style={{
            fontFamily: 'var(--trae-font-family-heading)',
            color: 'var(--trae-shader-fg)',
            letterSpacing: '0.18em',
            textIndent: '0.18em',
            textShadow: '0 0 40px var(--trae-status-primary-surface-l3)',
          }}
        >
          TDSF LINUX
        </h1>

        <button
          type="button"
          data-dom-id="boot-enter"
          aria-label="进入工作台"
          disabled={!loaded}
          onClick={handleEnter}
          className="boot-enter-btn"
        >
          <span className="boot-enter-label">进入工作台</span>
          <ArrowRight className="boot-enter-icon size-4" aria-hidden />
        </button>

        <div className="boot-progress" role="status" aria-live="polite">
          <div className="boot-progress-track">
            <div className="boot-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="boot-progress-label">
            {loaded ? '就绪 · 点击进入工作台' : '正在加载运维内核...'}
          </span>
        </div>
      </div>

      {/* 底部版本信息（SubTask 2.1.4） */}
      <footer
        className="boot-footer pointer-events-none absolute bottom-0 left-0 right-0 z-10 flex justify-center"
        style={{ padding: 'var(--spacing-16) 0' }}
      >
        <span className="boot-version">{BOOT_VERSION_TEXT}</span>
      </footer>

      <style>{`
        .boot-title {
          opacity: 0;
          transform: translateY(16px);
          animation: boot-fade-in 1s ease forwards;
          animation-delay: 0.3s;
        }

        /* 进入工作台按钮（SubTask 2.1.2）
         * 样式：背景 var(--trae-bg-brand) #387BFF，圆角 var(--trae-radius-6)，文字白色
         * 动效：进度条完成后（3.5s）缓慢浮现，1.4s ease-out 渐入 */
        .boot-enter-btn {
          position: relative;
          margin-top: 40px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 12px 28px;
          border: none;
          border-radius: var(--trae-radius-6);
          background: var(--trae-bg-brand);
          color: var(--trae-shader-fg);
          font-family: var(--trae-font-family-default);
          font-size: 14px;
          font-weight: 500;
          letter-spacing: 0.02em;
          cursor: pointer;
          pointer-events: auto;
          transition: background-color var(--trae-duration-fast) var(--trae-ease-out),
            box-shadow var(--trae-duration-fast) var(--trae-ease-out),
            transform var(--trae-duration-fast) var(--trae-ease-out),
            opacity var(--trae-duration-base) var(--trae-ease-out);
          opacity: 0;
          transform: translateY(20px);
          animation: boot-enter-in 1.4s var(--trae-ease-out) forwards;
          animation-delay: 3.5s;
        }
        .boot-enter-btn:disabled {
          cursor: default;
          background: var(--trae-bg-brand-disabled);
          box-shadow: none;
        }
        .boot-enter-btn:not(:disabled):hover {
          background: var(--trae-bg-brand-hover);
          box-shadow: var(--trae-glow-brand);
          transform: translateY(-1px);
        }
        .boot-enter-btn:not(:disabled):active {
          transform: translateY(0);
          background: var(--trae-bg-brand-active);
        }
        .boot-enter-btn:focus-visible {
          outline: 2px solid var(--trae-bg-brand);
          outline-offset: 3px;
        }
        .boot-enter-icon {
          transition: transform var(--trae-duration-base) var(--trae-ease-out);
        }
        .boot-enter-btn:not(:disabled):hover .boot-enter-icon {
          transform: translateX(3px);
        }

        /* 加载进度条（SubTask 2.1.3）：280×2px，0%→100% 3s 动画 */
        .boot-progress {
          margin-top: 32px;
          width: 280px;
          max-width: 80vw;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          opacity: 0;
          transform: translateY(12px);
          animation: boot-fade-in 0.8s ease forwards;
          animation-delay: 0.8s;
        }
        .boot-progress-track {
          width: 100%;
          height: 2px;
          background: var(--trae-shader-muted);
          border-radius: 1px;
          overflow: hidden;
        }
        .boot-progress-fill {
          height: 100%;
          background: var(--trae-bg-brand);
          border-radius: 1px;
          box-shadow: 0 0 8px var(--trae-status-primary-surface-l3);
          transition: width 0.08s linear;
        }
        .boot-progress-label {
          font-size: 11px;
          color: var(--trae-shader-muted-foreground);
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.04em;
        }

        /* 底部版本信息（SubTask 2.1.4） */
        .boot-footer {
          user-select: none;
        }
        .boot-version {
          font-family: var(--trae-font-family-default);
          font-size: 12px;
          color: var(--trae-text-tertiary);
          letter-spacing: 0.04em;
        }

        @keyframes boot-fade-in {
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes boot-enter-in {
          to { opacity: 1; transform: translateY(0); }
        }

        /* 无障碍：尊重用户减少动效偏好（SubTask 2.1.5）
         * 禁用进度条 / 按钮脉冲 / 入场动画；shader 核心视觉保留 */
        @media (prefers-reduced-motion: reduce) {
          .boot-title,
          .boot-enter-btn,
          .boot-progress {
            animation: none;
            opacity: 1;
            transform: none;
          }
          .boot-enter-icon,
          .boot-progress-fill {
            transition: none;
          }
        }
      `}</style>
    </main>
  )
}

export default BootPage
