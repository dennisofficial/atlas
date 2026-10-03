import { join, resolve } from 'node:path';
import { resolveConfig } from './config';
import { seedDevHome } from './dev-home';
import { spawnPtySession, type PtySession } from './pty';
import { EClientKind, parseClientMessage } from './protocol';

type SocketData = { session: PtySession | null };

const config = resolveConfig({ env: process.env, appDir: resolve(import.meta.dir, '..') });
const seed = await seedDevHome({
  sourceHome: config.sourceHome,
  devHome: config.devHome,
  reset: config.resetHome,
});

const indexHtml = await Bun.file(new URL('./public/index.html', import.meta.url)).text();

function isAuthorized({ url }: { url: URL }): boolean {
  return url.searchParams.get('token') === config.token;
}

function handleSocketMessage({ ws, raw }: { ws: Bun.ServerWebSocket<SocketData>; raw: string }): void {
  const session = ws.data.session;
  if (!session) return;
  const message = parseClientMessage({ raw });
  if (!message) return;
  if (message.kind === EClientKind.Input) {
    session.write(message.data);
    return;
  }
  if (message.kind === EClientKind.Resize) {
    session.resize({ cols: message.cols, rows: message.rows });
  }
}

const server = Bun.serve<SocketData>({
  port: config.port,
  hostname: '0.0.0.0',
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      if (!isAuthorized({ url })) return new Response('unauthorized', { status: 401 });
      const upgraded = srv.upgrade(req, { data: { session: null } });
      if (!upgraded) return new Response('expected a websocket upgrade', { status: 400 });
      return undefined;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      if (!isAuthorized({ url })) return new Response('unauthorized', { status: 401 });
      return new Response(indexHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    return new Response('not found', { status: 404 });
  },
  websocket: {
    open(ws) {
      const env: Record<string, string> = {
        ATLAS_HOME: config.devHome,
        ATLAS_WEBTERM_RC: seed.rcFile,
        ATLAS_WEBTERM_AUTOLAUNCH: config.autoLaunch ? '1' : '0',
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        PATH: `${join(config.repoRoot, 'apps', 'tui', 'bin')}:${process.env.PATH ?? ''}`,
      };
      ws.data.session = spawnPtySession({
        cwd: config.shellCwd,
        env,
        onOutput: (chunk) => {
          if (ws.readyState === 1) ws.sendBinary(chunk);
        },
        onExit: (code) => {
          try {
            ws.send(JSON.stringify({ t: 'exit', code }));
            ws.close();
          } catch {
            void 0;
          }
        },
      });
    },
    message(ws, message) {
      if (typeof message !== 'string') return;
      handleSocketMessage({ ws, raw: message });
    },
    close(ws) {
      ws.data.session?.kill();
      ws.data.session = null;
    },
  },
});

console.log('atlas web terminal');
console.log(`  listening:  http://0.0.0.0:${server.port}/?token=${config.token}`);
console.log(`  dev home:   ${seed.devHome}${seed.hadCredentials ? '' : ' (no credentials found in source home)'}`);
console.log(`  seeded:     ${seed.copiedCount} entries from ${config.sourceHome}`);
console.log(`  shell cwd:  ${config.shellCwd}`);
