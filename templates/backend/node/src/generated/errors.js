// [LC-GENERATED] 平台生成区：重新生成会整块替换，不要在这里手改。
// 用户区代码可以引用这里的错误类型与响应包装，当作稳定的公共接口使用。
export class AppError extends Error {
  constructor(status, code, message, detail = '', field = '', fields = null) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.detail = detail
    this.field = field
    this.fields = Array.isArray(fields) && fields.length ? fields : null
  }
}

export const errorBody = (code, message, detail = '', field = '', fields = null) => {
  const error = { code, message, detail, field }
  if (Array.isArray(fields) && fields.length) error.fields = fields
  return { ok: false, error }
}

export const okBody = (data) => ({ ok: true, data })

export const invalidArgument = (field, message) =>
  new AppError(400, 'LC_E_INVALID_ARGUMENT', message, '', field)

export const notFound = (message = '记录不存在') => new AppError(404, 'LC_E_NOT_FOUND', message)
