export const MCP_ENDPOINT = 'https://mcp.mcd.cn';

export interface Config {
  port: number;
  token?: string;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawPort = env.PORT ?? '3210';
  if (!/^\d+$/.test(rawPort) || +rawPort < 1024 || +rawPort > 65535) {
    throw new Error('PORT 必须是 1024–65535 之间的整数。');
  }
  const token = env.MCD_MCP_TOKEN?.trim() || undefined;
  if (token && (/[\r\n]/.test(token) || token.length > 8192 || token.startsWith('Bearer '))) {
    throw new Error('MCD_MCP_TOKEN 格式无效：使用官方原始 Token，不添加 Bearer。');
  }
  return { port: +rawPort, token };
}
