// SSH 摸底脚本 - 一次性探查 192.168.45.200 系统信息
// 凭据从 .env.local 读取（不入代码库），避免 dotenv 依赖
const fs = require('fs')
const path = require('path')
const { Client } = require('ssh2')

// 解析 .env.local（key=value 格式，跳过注释和空行）
function loadEnv(file) {
  const env = {}
  if (!fs.existsSync(file)) return env
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && !m[1].startsWith('#')) {
      env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
  }
  return env
}

const env = loadEnv(path.join(__dirname, '..', '.env.local'))
const HOST = env.TDSF_SSH_HOST
const PORT = parseInt(env.TDSF_SSH_PORT || '22', 10)
const USER = env.TDSF_SSH_USER
const PASS = env.TDSF_SSH_PASSWORD
const NICK = env.TDSF_SSH_NICKNAME

if (!HOST || !USER || !PASS) {
  console.error('缺少 SSH 凭据（.env.local）')
  process.exit(1)
}

/** 一次性 SSH 命令执行 */
function sshExec(conn, cmd, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout: ${cmd}`)), timeoutMs)
    conn.exec(cmd, (err, stream) => {
      if (err) {
        clearTimeout(t)
        return reject(err)
      }
      let out = ''
      let errOut = ''
      stream
        .on('close', (code) => {
          clearTimeout(t)
          resolve({ code, stdout: out, stderr: errOut })
        })
        .on('data', (data) => { out += data.toString() })
        .stderr.on('data', (data) => { errOut += data.toString() })
    })
  })
}

/** 探查命令清单 */
const PROBE_COMMANDS = [
  // === 系统标识 ===
  { group: '系统标识', cmd: 'uname -a' },
  { group: '系统标识', cmd: 'cat /etc/os-release 2>/dev/null || cat /etc/redhat-release 2>/dev/null || cat /etc/lsb-release 2>/dev/null || echo "未识别发行版"' },
  { group: '系统标识', cmd: 'hostname -f 2>/dev/null; hostname' },
  { group: '系统标识', cmd: 'uptime' },
  { group: '系统标识', cmd: 'date' },

  // === CPU 与内存 ===
  { group: 'CPU 与内存', cmd: 'lscpu | head -20' },
  { group: 'CPU 与内存', cmd: 'nproc; cat /proc/cpuinfo | grep "model name" | head -1' },
  { group: 'CPU 与内存', cmd: 'free -h' },

  // === 磁盘 ===
  { group: '存储', cmd: 'lsblk -a 2>/dev/null || echo "lsblk 未安装"' },
  { group: '存储', cmd: 'df -hT | head -20' },
  { group: '存储', cmd: 'mount | head -20' },

  // === 网络 ===
  { group: '网络', cmd: 'ip addr show 2>/dev/null || ifconfig 2>/dev/null || echo "无网络工具"' },
  { group: '网络', cmd: 'ip route 2>/dev/null || route -n 2>/dev/null' },
  { group: '网络', cmd: 'cat /etc/resolv.conf 2>/dev/null | head -5' },
  { group: '网络', cmd: 'ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo "无端口查看工具"' },

  // === 用户与权限 ===
  { group: '用户', cmd: 'whoami; id' },
  { group: '用户', cmd: 'cat /etc/passwd | grep -v nologin | grep -v false' },
  { group: '用户', cmd: 'sudo -n true 2>&1 | head -3' },

  // === 服务与进程 ===
  { group: '服务', cmd: 'systemctl list-units --type=service --state=running 2>/dev/null | head -30 || ps aux | head -30' },
  { group: '服务', cmd: 'systemctl list-unit-files --type=service --state=enabled 2>/dev/null | head -30' },

  // === 软件清单（关键：看下学期的工具是否预装） ===
  { group: '开发工具', cmd: 'for tool in python python3 node npm java gcc g++ make git curl wget vim nano ssh rsync docker podman nginx apache2 httpd mysql mariadb psql redis-server php php-fpm; do command -v $tool >/dev/null && echo "✓ $tool: $(command -v $tool)" || echo "✗ $tool: 未安装"; done' },

  // === 软件版本 ===
  { group: '版本信息', cmd: 'python3 --version 2>/dev/null; node --version 2>/dev/null; nginx -v 2>&1; apache2 -v 2>&1 | head -1; mysql --version 2>/dev/null; php -v 2>/dev/null | head -1; git --version' },

  // === 虚拟化检测 ===
  { group: '虚拟化', cmd: 'systemd-detect-virt 2>/dev/null || echo "未检测到虚拟化" ' },
  { group: '虚拟化', cmd: 'cat /proc/1/cgroup 2>/dev/null | head -5' },

  // === 已部署的 Web 应用 ===
  { group: 'Web 应用', cmd: 'ls /var/www/ 2>/dev/null; ls /usr/share/nginx/html/ 2>/dev/null; ls /etc/nginx/sites-enabled/ 2>/dev/null; ls /etc/apache2/sites-enabled/ 2>/dev/null' },

  // === 定时任务与日志 ===
  { group: '运维', cmd: 'crontab -l 2>/dev/null; ls /etc/cron.d/ 2>/dev/null' },
  { group: '运维', cmd: 'ls /var/log/ 2>/dev/null | head -20' }
]

async function main() {
  console.log(`🔌 正在 SSH 连接 ${USER}@${HOST}:${PORT} (${NICK})...`)
  const conn = new Client()

  await new Promise((resolve, reject) => {
    conn.on('ready', resolve)
      .on('error', reject)
      .connect({
        host: HOST,
        port: PORT,
        username: USER,
        password: PASS,
        readyTimeout: 15000
      })
  })
  console.log('✅ SSH 连接成功\n')

  // 按组聚合结果
  const results = {}
  let okCount = 0
  let failCount = 0

  for (const { group, cmd } of PROBE_COMMANDS) {
    try {
      const r = await sshExec(conn, cmd)
      results[group] = results[group] || []
      results[group].push({ cmd, stdout: r.stdout.trim(), stderr: r.stderr.trim(), code: r.code })
      okCount++
    } catch (err) {
      results[group] = results[group] || []
      results[group].push({ cmd, error: err.message, stdout: '' })
      failCount++
    }
  }

  // 打印结果（按组）
  console.log('═'.repeat(80))
  console.log(`📋 探查报告 - ${NICK} (${HOST})`)
  console.log(`📊 成功 ${okCount} / 失败 ${failCount} / 总计 ${PROBE_COMMANDS.length}`)
  console.log('═'.repeat(80))

  for (const [group, items] of Object.entries(results)) {
    console.log(`\n## ${group}\n`)
    for (const it of items) {
      console.log(`### $ ${it.cmd}`)
      if (it.error) {
        console.log(`[ERROR] ${it.error}`)
      } else {
        console.log(it.stdout || '(空输出)')
        if (it.stderr && it.stderr !== '(空输出)') {
          console.log(`[STDERR] ${it.stderr}`)
        }
      }
      console.log()
    }
  }

  conn.end()
  console.log('\n✅ 探查完成')
}

main().catch((err) => {
  console.error('❌ 探查失败:', err.message)
  process.exit(1)
})
