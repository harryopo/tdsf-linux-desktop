/**
 * 数据库状态共享类型（A4：SQLite 降级可见化）
 *
 * 主进程 DatabaseManager.getStatus() 与渲染层横幅共用同一份契约，
 * 避免 preload / electron.d.ts 两侧手写重复类型。
 */

/**
 * 数据库运行状态
 *
 * available=false 表示 better-sqlite3 未能打开真实数据库文件，
 * 此时所有写入会被拒绝、读取返回空结果，界面上必须出现降级横幅。
 */
export interface DbStatus {
  /** 数据库是否真实可用（false = 已降级，数据不会持久化） */
  available: boolean
  /** sqlite-vec 向量扩展是否加载成功（false 时检索降级到关键词） */
  vectorEnabled: boolean
  /** 迁移完成后 PRAGMA user_version 的实际值；降级时为 null */
  schemaVersion: number | null
  /** MIGRATIONS 表中的最高版本号，用于发现"迁移未跑完" */
  targetSchemaVersion: number
  /** 降级原因（含底层错误消息，供横幅直接展示）；available=true 时为 null */
  degradedReason: string | null
  /** 迁移过程中被吞掉的错误；schemaVersion < targetSchemaVersion 时必然非空 */
  migrationError: string | null
  /** schemaVersion 落后于 targetSchemaVersion（迁移中途失败） */
  migrationPending: boolean
}
