/**
 * BootPage — Shader 动画启动页（按设计稿 1:1 恢复）
 *
 * // @ai-session: ai-claude-20260720-boot
 * // @ai-task: Restore-shader-boot-page
 *
 * 路由：/ 与 /boot
 * 设计稿：tdsf-linux-redesign/pages/boot.html
 *
 * 视觉：
 * - 纯黑底 + Three.js 全屏 fragment shader 流光
 * - 居中大标题 TDSF LINUX
 * - 进度条 3s 填充
 * - 「进入工作台」按钮在进度完成后缓入，点击 → /workbench
 *
 * 历史问题：曾被改成白底左上角极简条，用户反馈「一片白」且不像设计稿。
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

/** BootPage Shader 启动加载页 */
export function BootPage() {
  const navigate = useNavigate()
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [webglFailed, setWebglFailed] = useState(false)
  const timersRef = useRef<number[]>([])

  // Three.js shader 背景
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
      return
    }
  }, [])

  // 进度条 0 → 100（约 3s，与设计稿一致）
  useEffect(() => {
    const startAt = Date.now() + 500
    const duration = 3000
    const id = window.setInterval(() => {
      const now = Date.now()
      if (now < startAt) return
      const t = Math.min((now - startAt) / duration, 1)
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
  }, [])

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
      className="relative h-screen w-screen overflow-hidden bg-black"
      aria-label="TDSF Linux 运维助手 启动加载"
    >
      {/* Shader 背景 */}
      <div
        ref={canvasHostRef}
        className="absolute inset-0 z-0 overflow-hidden bg-black"
        aria-hidden
      />
      {webglFailed && (
        <div
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{
            background:
              'radial-gradient(ellipse at 50% 40%, rgba(29,78,216,0.35) 0%, rgba(0,0,0,0.95) 55%, #000 100%)',
          }}
        />
      )}

      {/* 前景：居中标题 + 按钮 + 进度 */}
      <div
        className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center"
        style={{ paddingBottom: '4vh' }}
      >
        <h1
          className="boot-title whitespace-nowrap text-center text-7xl font-semibold text-white"
          style={{
            fontFamily:
              '"SF Pro Text", "Microsoft YaHei", system-ui, -apple-system, sans-serif',
            letterSpacing: '0.18em',
            textIndent: '0.18em',
            textShadow:
              '0 0 40px rgba(56, 123, 255, 0.35), 0 0 12px rgba(0, 0, 0, 0.6)',
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
          <span>进入工作台</span>
          <ArrowRight className="boot-enter-icon size-4" aria-hidden />
        </button>

        <div className="boot-progress" role="status" aria-live="polite">
          <div className="boot-progress-track">
            <div
              className="boot-progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="boot-progress-label">
            {loaded ? '就绪' : `加载中 ${progress}%`}
          </span>
        </div>
      </div>

      <style>{`
        .boot-title {
          opacity: 0;
          transform: translateY(16px);
          animation: boot-fade-in 1s ease forwards;
          animation-delay: 0.3s;
        }

        .boot-enter-btn {
          position: relative;
          margin-top: 40px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 12px 28px;
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.05);
          color: #FFFFFF;
          font-family: "SF Pro Text", "Microsoft YaHei", system-ui, -apple-system, sans-serif;
          font-size: 14px;
          font-weight: 500;
          letter-spacing: 0.02em;
          cursor: pointer;
          pointer-events: auto;
          -webkit-backdrop-filter: blur(8px);
          backdrop-filter: blur(8px);
          transition: border-color 0.3s ease, background-color 0.3s ease,
            box-shadow 0.3s ease, transform 0.2s ease, opacity 0.4s ease;
          opacity: 0;
          transform: translateY(20px);
          animation: boot-enter-in 1.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          animation-delay: 3.5s;
        }
        .boot-enter-btn:disabled {
          cursor: default;
        }
        .boot-enter-btn:not(:disabled):hover {
          border-color: #387BFF;
          background: rgba(56, 123, 255, 0.14);
          box-shadow: 0 0 28px rgba(56, 123, 255, 0.4),
            0 0 0 1px rgba(56, 123, 255, 0.2) inset;
          transform: translateY(-1px);
        }
        .boot-enter-btn:not(:disabled):active {
          transform: translateY(0);
          background: rgba(56, 123, 255, 0.22);
        }
        .boot-enter-btn:focus-visible {
          outline: 2px solid #387BFF;
          outline-offset: 3px;
        }
        .boot-enter-icon {
          transition: transform 0.3s ease;
        }
        .boot-enter-btn:not(:disabled):hover .boot-enter-icon {
          transform: translateX(3px);
        }

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
          background: rgba(255, 255, 255, 0.1);
          border-radius: 1px;
          overflow: hidden;
        }
        .boot-progress-fill {
          height: 100%;
          background: linear-gradient(
            90deg,
            rgba(255, 255, 255, 0.35) 0%,
            #FFFFFF 50%,
            #387BFF 100%
          );
          border-radius: 1px;
          box-shadow: 0 0 8px rgba(56, 123, 255, 0.5);
          transition: width 0.08s linear;
        }
        .boot-progress-label {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.45);
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.04em;
        }

        @keyframes boot-fade-in {
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes boot-enter-in {
          to { opacity: 1; transform: translateY(0); }
        }

        @media (prefers-reduced-motion: reduce) {
          .boot-title,
          .boot-enter-btn,
          .boot-progress {
            animation: none;
            opacity: 1;
            transform: none;
          }
          .boot-enter-icon {
            transition: none;
          }
        }
      `}</style>
    </main>
  )
}

export default BootPage
