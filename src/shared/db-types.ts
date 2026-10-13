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

/**
 * 一张只增类表的体积读数（#94）
 *
 * rows/oldestAt/newestAt 为 null 的两种情况要分开看：
 * error 非空 = 这张表读失败了；error 为空 = 表是空的。
 * 界面不许把"读失败"显示成"0 条"——那是把故障演成清白。
 */
export interface DbTableGrowth {
  /** SQL 里的表名，同时是判据的键 */
  table: string
  /** 界面上的中文名 */
  label: string
  /** 行数；读取失败时为 null */
  rows: number | null
  /** 最早一条的时间戳（毫秒）；空表或失败为 null */
  oldestAt: number | null
  /** 最新一条的时间戳（毫秒）；空表或失败为 null */
  newestAt: number | null
  /** 自动保留天数；null = 不删，永久累积 */
  retentionDays: number | null
  /** 这张表单独的读取失败原因；成功为 null */
  error: string | null
}

/** 本地数据的体积台账（只显示，界面上不提供清理入口） */
export interface DbGrowth {
  /** 库文件字节数；内存库或 stat 失败为 null */
  fileBytes: number | null
  /** 库文件绝对路径；内存库为 ':memory:' */
  filePath: string
  /** 逐表读数，顺序即展示顺序 */
  tables: DbTableGrowth[]
}
