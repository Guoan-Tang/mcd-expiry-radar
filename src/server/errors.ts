export class AppError extends Error {
  constructor(public code: string, message: string, public status = 502) {
    super(message);
  }
}

export function safeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError('UPSTREAM_ERROR', 'MCP 请求未完成。请检查网络与服务状态后重试；未切换演示数据。');
}
