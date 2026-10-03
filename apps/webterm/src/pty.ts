import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type PtySession = {
  write: (data: string) => void;
  resize: (size: TerminalSize) => void;
  kill: () => void;
};

export type TerminalSize = { cols: number; rows: number };

type PtyCallbacks = {
  onOutput: (chunk: Uint8Array) => void;
  onExit: (code: number) => void;
};

const PTS_POLL_INTERVAL_MS = 20;
const PTS_POLL_ATTEMPTS = 150;

function scriptCommand({ inner }: { inner: string }): string[] {
  if (process.platform === 'darwin') {
    return ['script', '-q', '/dev/null', 'sh', '-c', inner];
  }
  return ['script', '-qec', inner, '/dev/null'];
}

function buildInnerShell(): string {
  return [
    'tty > "$ATLAS_WEBTERM_TTYFILE.part"',
    'mv "$ATLAS_WEBTERM_TTYFILE.part" "$ATLAS_WEBTERM_TTYFILE"',
    'exec bash --rcfile "$ATLAS_WEBTERM_RC" -i',
  ].join('; ');
}

function sttyCommand({ pts, cols, rows }: { pts: string } & TerminalSize): string[] {
  const flag = process.platform === 'darwin' ? '-f' : '-F';
  return ['stty', flag, pts, 'rows', String(rows), 'cols', String(cols)];
}

async function pumpStream({
  stream,
  onOutput,
}: {
  stream: ReadableStream<Uint8Array>;
  onOutput: PtyCallbacks['onOutput'];
}): Promise<void> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value && value.length > 0) onOutput(value);
    }
  } catch {
    return;
  }
}

async function waitForPts({ ttyFile }: { ttyFile: string }): Promise<string | null> {
  for (let attempt = 0; attempt < PTS_POLL_ATTEMPTS; attempt += 1) {
    try {
      const pts = (await readFile(ttyFile, 'utf8')).trim();
      if (pts.length > 0) return pts;
    } catch {
      void 0;
    }
    await new Promise((resolve) => setTimeout(resolve, PTS_POLL_INTERVAL_MS));
  }
  return null;
}

function cleanEnv({ env }: { env: Record<string, string | undefined> }): Record<string, string> {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) cleaned[key] = value;
  }
  return cleaned;
}

export function spawnPtySession({
  cwd,
  env,
  onOutput,
  onExit,
}: {
  cwd: string;
  env: Record<string, string>;
} & PtyCallbacks): PtySession {
  let killed = false;
  let pts: string | null = null;
  let pendingSize: TerminalSize = { cols: 80, rows: 24 };

  const ttyDirPromise = mkdtemp(join(tmpdir(), 'atlas-webterm-'));

  const spawnArgs = async (): Promise<{ cmd: string[]; env: Record<string, string> }> => {
    const ttyDir = await ttyDirPromise;
    return {
      cmd: scriptCommand({ inner: buildInnerShell() }),
      env: {
        ...env,
        ATLAS_WEBTERM_TTYFILE: join(ttyDir, 'pts'),
      },
    };
  };

  const procReady = spawnArgs().then(({ cmd, env: spawnEnv }) => {
    const proc = Bun.spawn({
      cmd,
      cwd,
      env: cleanEnv({ env: { ...process.env, ...spawnEnv } }),
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    void pumpStream({ stream: proc.stdout, onOutput });
    void pumpStream({ stream: proc.stderr, onOutput });
    void proc.exited.then((code) => {
      if (!killed) onExit(code);
      void ttyDirPromise.then((dir) => rm(dir, { recursive: true, force: true }));
    });

    void waitForPts({ ttyFile: spawnEnv.ATLAS_WEBTERM_TTYFILE ?? '' }).then((found) => {
      if (!found) return;
      pts = found;
      Bun.spawnSync(sttyCommand({ pts: found, ...pendingSize }));
    });

    return proc;
  });

  return {
    write(data) {
      void procReady.then((proc) => {
        if (proc.stdin === null) return;
        void proc.stdin.write(data);
        void proc.stdin.flush();
      });
    },
    resize(size) {
      pendingSize = size;
      if (pts === null) return;
      Bun.spawnSync(sttyCommand({ pts, ...size }));
    },
    kill() {
      killed = true;
      void procReady.then((proc) => {
        try {
          Bun.spawnSync(['pkill', '-TERM', '-P', String(proc.pid)]);
        } catch {
          void 0;
        }
        proc.kill();
        void ttyDirPromise.then((dir) => rm(dir, { recursive: true, force: true }));
      });
    },
  };
}
