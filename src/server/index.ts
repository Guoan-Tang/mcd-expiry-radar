import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import express from 'express';
import { createApp } from './app.js';
import { readConfig } from './config.js';

if (existsSync('.env')) loadEnvFile('.env');
const config = readConfig();
const development = process.argv.includes('--dev');
const app = createApp(config, undefined, development);
const server = createServer(app);

if (development) {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ server: { middlewareMode: true, hmr: { server } } });
  app.use(vite.middlewares);
} else {
  const root = fileURLToPath(new URL('../client/', import.meta.url));
  if (!existsSync(resolve(root, 'index.html'))) throw new Error('缺少构建文件；先运行 npm run build。');
  app.use(express.static(root, { dotfiles: 'deny', etag: false, maxAge: 0 }));
  app.use((req, res) => {
    if (req.method === 'GET' && req.path === '/') res.sendFile(resolve(root, 'index.html'));
    else res.status(404).send('页面不存在');
  });
}

server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(error.code === 'EADDRINUSE' ? '端口已被占用，请在 .env 修改 PORT。' : '本地服务启动失败。');
  process.exitCode = 1;
});
server.listen(config.port, '127.0.0.1', () => {
  console.log(`麦麦到期雷达 http://127.0.0.1:${config.port} · 只读 · ${config.token ? '真实模式可用' : '未配置 Token，可体验演示'}`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
