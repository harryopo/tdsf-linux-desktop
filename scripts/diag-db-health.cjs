/**
 * 诊断脚本：用 Electron Node ABI 检查数据库完整性
 */
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')

const homedir = os.homedir()
const platform = process.platform
const appData = platform === 'win32'
  ? path.join(homedir, 'AppData', 'Roaming')
  : platform === 'darwin'
    ? path.join(homedir, 'Library', 'Application Support')
    : path.join(homedir, '.config')
const userDataDir = path.join(appData, 'tdsf-linux-desktop')
const dbPath = path.join(userDataDir, 'tdsf.db')

console.log('[diag] Node version:', process.version)
console.log('[diag] Node ABI:', process.versions.modules)
console.log('[diag] ELECTRON_RUN_AS_NODE:', process.env.ELECTRON_RUN_AS_NODE)
console.log('[diag] dbPath:', dbPath)
console.log('[diag] dbPath exists:', fs.existsSync(dbPath))

if (fs.existsSync(dbPath)) {
  const stat = fs.statSync(dbPath)
  console.log('[diag] db size:', (stat.size / 1024).toFixed(1), 'KB')
  console.log('[diag] db mtime:', stat.mtime.toISOString())
}

// 列出 .db 相关文件
console.log('\n[diag] 相关文件:')
if (fs.existsSync(userDataDir)) {
  const files = fs.readdirSync(userDataDir)
  for (const f of files) {
    if (f.includes('tdsf')) {
      const fp = path.join(userDataDir, f)
      const s = fs.statSync(fp)
      console.log(`  ${f}: ${(s.size / 1024).toFixed(1)} KB (${s.mtime.toISOString()})`)
    }
  }
}

// 用 better-sqlite3 打开
console.log('\n[diag] 尝试打开数据库:')
try {
  const Database = require('better-sqlite3')
  const db = new Database(dbPath)

  // integrity_check
  const integrity = db.pragma('integrity_check')
  console.log('[diag] integrity_check:')
  for (const row of integrity) {
    console.log(' ', JSON.stringify(row))
  }

  // 表列表
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
  console.log('\n[diag] 表数量:', tables.length)
  console.log('[diag] 表列表:')
  for (const t of tables) {
    console.log(' ', t.name)
  }

  // knowledge_entries 统计
  try {
    const total = db.prepare("SELECT COUNT(*) as cnt FROM knowledge_entries WHERE type='tutorial'").get()
    console.log('\n[diag] tutorial 总数:', total.cnt)

    const pendingEmbed = db.prepare("SELECT COUNT(*) as cnt FROM knowledge_entries WHERE type='tutorial' AND embedding IS NULL").get()
    console.log('[diag] 待回填 embedding:', pendingEmbed.cnt)

    const hasEmbed = db.prepare("SELECT COUNT(*) as cnt FROM knowledge_entries WHERE type='tutorial' AND embedding IS NOT NULL").get()
    console.log('[diag] 已有 embedding:', hasEmbed.cnt)

    // 查看前 3 条样本
    const samples = db.prepare("SELECT id, title, length(embedding) as emb_len FROM knowledge_entries WHERE type='tutorial' LIMIT 3").all()
    console.log('\n[diag] 样本:')
    for (const s of samples) {
      console.log(`  id=${s.id}, title="${s.title}", emb_len=${s.emb_len}`)
    }
  } catch (err) {
    console.log('[diag] 查询 knowledge_entries 失败:', err.message)
  }

  db.close()
} catch (err) {
  console.log('[diag] 打开数据库失败:', err.message)
}
