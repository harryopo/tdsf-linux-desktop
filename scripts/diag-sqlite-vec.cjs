/**
 * 诊断脚本：sqlite-vec 扩展加载失败原因（ELECTRON_RUN_AS_NODE 模式）
 *
 * 使用 Electron 内置 Node.js（与 better-sqlite3 ABI 匹配），
 * 复现 database.ts 中 tryLoadVectorExtension 的失败。
 */
const path = require('node:path')
const os = require('node:os')

console.log('[diag] process.version:', process.version)
console.log('[diag] process.versions.modules:', process.versions.modules)
console.log('[diag] ELECTRON_RUN_AS_NODE:', process.env.ELECTRON_RUN_AS_NODE)

const Database = require('better-sqlite3')
const sqliteVec = require('@photostructure/sqlite-vec')
console.log('[diag] sqliteVec exports:', Object.keys(sqliteVec))
try {
  console.log('[diag] sqliteVec.getLoadablePath():', sqliteVec.getLoadablePath())
} catch (e) {
  console.log('[diag] getLoadablePath 失败:', e.message)
}

const dbPath = path.join(os.tmpdir(), `diag-vec-${Date.now()}.db`)
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
console.log('[diag] DB opened at:', dbPath)
console.log('[diag] better-sqlite3 loaded OK')

// 1. 先用 better-sqlite3 自带的 loadExtension 试试
try {
  const vecPath = sqliteVec.getLoadablePath()
  console.log('[diag] 尝试 db.loadExtension(vecPath):', vecPath)
  db.loadExtension(vecPath)
  console.log('[diag] loadExtension 成功')
} catch (err) {
  console.log('[diag] loadExtension 失败:', err.message)
  console.log('[diag] err.code:', err.code)
}

// 2. 再用 sqliteVec.load(db) 试试（photostructure 提供的封装）
try {
  // 重置 DB 状态后重试
  const db2 = new Database(dbPath + '.2')
  db2.pragma('journal_mode = WAL')
  console.log('[diag] 尝试 sqliteVec.load(db2):')
  sqliteVec.load(db2)
  console.log('[diag] sqliteVec.load 成功')

  // 验证 vec0 表能创建
  db2.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS test_vec USING vec0(embedding float[4]);`)
  console.log('[diag] vec0 虚拟表创建成功')

  const insert = db2.prepare(`INSERT INTO test_vec(rowid, embedding) VALUES (?, ?)`)
  insert.run(1, Buffer.from(new Float32Array([1.0, 0.0, 0.0, 0.0]).buffer))
  insert.run(2, Buffer.from(new Float32Array([0.0, 1.0, 0.0, 0.0]).buffer))
  insert.run(3, Buffer.from(new Float32Array([0.0, 0.0, 1.0, 0.0]).buffer))
  console.log('[diag] 向量插入成功（3 条）')

  const result = db2.prepare(`SELECT rowid, distance FROM test_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 1`)
    .all(Buffer.from(new Float32Array([1.0, 0.0, 0.0, 0.0]).buffer))
  console.log('[diag] KNN 查询结果:', result)

  db2.close()
} catch (err) {
  console.log('[diag] sqliteVec.load 或 vec0 操作失败:', err.message)
  console.log('[diag] err.stack:', err.stack)
}

db.close()
console.log('[diag] 完成')
