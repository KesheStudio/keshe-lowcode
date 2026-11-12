/**
 * 存储层错误码（与 CONTRACTS 第 19 节对应）。
 * 所有错误都带 code，HTTP 层据此映射状态码，禁止把原始堆栈直接抛给用户。
 */
export const STORAGE_ERRORS = {
  PATH_UNSAFE: 'LC_E_PATH_UNSAFE',
  READONLY: 'LC_E_STORAGE_READONLY',
  LOCKED: 'LC_E_STORAGE_LOCKED',
  TXN_RECOVER: 'LC_E_TXN_RECOVER',
  FILE_CORRUPT: 'LC_E_FILE_CORRUPT',
  REV_CONFLICT: 'LC_E_REV_CONFLICT',
  NOT_FOUND: 'LC_E_NOT_FOUND',
  CONFIG_INVALID: 'LC_E_CONFIG_INVALID'
};

export class StorageError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.detail = detail || null;
  }
}

export class PathUnsafeError extends StorageError {
  constructor(relPath, reason) {
    super(STORAGE_ERRORS.PATH_UNSAFE, `路径不安全：${relPath}`, { path: relPath, reason });
  }
}

export class StorageLockedError extends StorageError {
  constructor(siteId, holder) {
    /* 锁持有者只回传时间，不暴露 PID / 主机名 / 锁令牌等进程内部信息。 */
    const safe = holder && holder.acquiredAt ? { acquiredAt: holder.acquiredAt } : null;
    super(STORAGE_ERRORS.LOCKED, `站点「${siteId}」正在被另一个进程写入`, safe);
    this.statusCode = 423;
  }
}

export class RevConflictError extends StorageError {
  constructor(expected, current) {
    super(STORAGE_ERRORS.REV_CONFLICT, `版本冲突：期望 rev ${expected}，当前 rev ${current}`, { expected, current });
    this.statusCode = 409;
    this.currentRev = current;
  }
}

export class FileMissingError extends StorageError {
  constructor(relPath) {
    super(STORAGE_ERRORS.NOT_FOUND, `文件不存在：${relPath}`, { path: relPath });
    this.statusCode = 404;
  }
}
