/**
 * 存储层公开类型（JSDoc）。
 * 并行会话请只依赖这里的签名，不要直接依赖 FsStorageAdapter 内部实现。
 *
 * @typedef {'utf8'|'buffer'} ReadEncoding
 *
 * @typedef {Object} FileStat
 * @property {string} path        相对站点根的 posix 路径
 * @property {number} size        字节数
 * @property {string} mtime       ISO 时间
 * @property {string} hash        sha256（文件不存在时为空串）
 * @property {boolean} exists
 *
 * @typedef {Object} FileEntry
 * @property {string} path        相对路径
 * @property {'file'|'dir'} kind
 * @property {number} size
 * @property {string} mtime
 *
 * @typedef {Object} WriteResult
 * @property {string} path
 * @property {number} rev
 * @property {string} hash
 * @property {number} bytes
 *
 * @typedef {Object} StorageTx
 * @property {(path: string, data: string|Buffer) => Promise<void>} write  暂存写（提交前不落目标）
 * @property {(path: string) => Promise<void>} delete                      暂存删
 * @property {() => Promise<void>} rollback                                放弃本次事务
 *
 * @typedef {Object} StorageAdapter
 * @property {(path: string, opts?: {encoding?: ReadEncoding}) => Promise<string|Buffer>} read
 * @property {(path: string) => Promise<FileStat>} stat
 * @property {(dir: string, opts?: {recursive?: boolean, depth?: number}) => Promise<FileEntry[]>} list
 * @property {(path: string, data: string|Buffer, opts?: {atomic?: boolean, expectedRev?: number}) => Promise<WriteResult>} write
 * @property {(path: string, opts?: {recursive?: boolean}) => Promise<void>} delete
 * @property {(from: string, to: string) => Promise<void>} move
 * @property {(siteId: string, fn: (tx: StorageTx) => Promise<any>) => Promise<any>} transaction
 * @property {(siteId: string) => Promise<number>} rev
 */

/**
 * 创建站点级适配器的工厂签名。
 * @typedef {(dataRoot: string, siteId: string, options?: Object) => StorageAdapter} CreateSiteAdapter
 */
export const STORAGE_LAYOUT_VERSION = 2;
