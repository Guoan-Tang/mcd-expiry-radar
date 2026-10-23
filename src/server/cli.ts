import { existsSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { readConfig } from './config.js';
import { demoSnapshot } from './demo.js';
import { createCalendar } from './ics.js';
import { loadLive } from './mcp.js';
import { AppError, safeError } from './errors.js';

async function main() {
  const args = process.argv.slice(2);
  const mode = args.shift();
  if (!['--demo', '--live'].includes(mode ?? '') ||
      (args.length !== 0 && (args.length !== 4 || args[0] !== '--ids' || args[2] !== '--out' || !args[3].endsWith('.ics')))) {
    throw new AppError('USAGE', '用法：npm run radar -- --demo|--live [--ids id1,id2 --out reminders.ics]。导出需明确选择有日期的 ID。', 400);
  }
  if (existsSync('.env')) loadEnvFile('.env');
  const config = readConfig();
  if (mode === '--live' && !config.token) throw new AppError('TOKEN_MISSING', '请在本地环境或 .env 配置 MCD_MCP_TOKEN；不要粘贴到聊天。', 503);
  const snapshot = mode === '--demo' ? demoSnapshot() : await loadLive(config.token!);
  if (args.length) {
    const calendar = createCalendar(snapshot, args[1].split(','));
    try {
      writeFileSync(args[3], calendar, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
        throw new AppError('FILE_EXISTS', '输出文件已存在，请使用新的 .ics 文件名。', 409);
      }
      throw new AppError('FILE_WRITE_FAILED', '无法写入日历，请检查输出目录和文件权限。', 500);
    }
    console.log('日历文件已创建；未覆盖已有文件。请在日历客户端核实提醒设置。');
  } else {
    console.log(JSON.stringify(snapshot, null, 2));
  }
  if (snapshot.sources.some((source) => ['error', 'unsupported'].includes(source.state))) process.exitCode = 2;
}

main().catch((error: unknown) => {
  const safe = safeError(error);
  console.error(`[${safe.code}] ${safe.message}`);
  process.exitCode = 1;
});
