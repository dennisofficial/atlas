export interface INextServer {
  origin: string
  stop: () => Promise<void>
}

export interface INextServerChild {
  kill: (signal?: 'SIGTERM' | 'SIGKILL') => void
  exited: Promise<number>
  output: () => string
}

export interface INextServerPorts {
  spawn: (args: { root: string; bunPath: string; port: number }) => INextServerChild
  freePort: () => Promise<number>
  ready: (origin: string) => Promise<boolean>
  sleep: (ms: number) => Promise<void>
  now: () => number
}

export const NEXT_SERVER_START_TIMEOUT_MS = 20_000
const STOP_TIMEOUT_MS = 2_000
const POLL_MS = 100
const OUTPUT_LIMIT = 8_000

export function bunPathOf({
  onPath,
  execPath,
}: {
  onPath: string | null
  execPath: string
}): string {
  if (onPath !== null) return onPath
  if (execPath.split('/').pop()?.startsWith('bun') === true) return execPath
  throw new Error(`no bun executable to run the app server; the runtime is ${execPath}`)
}

export function bunPath(): string {
  return bunPathOf({ onPath: Bun.which('bun'), execPath: process.execPath })
}

async function freePort(): Promise<number> {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') })
  const port = server.port as number
  await server.stop(true)
  return port
}

async function ready(origin: string): Promise<boolean> {
  try {
    const response = await fetch(origin, { signal: AbortSignal.timeout(1_500) })
    return response.ok
  } catch {
    return false
  }
}

function spawnServer({
  root,
  bunPath: executable,
  port,
}: {
  root: string
  bunPath: string
  port: number
}): INextServerChild {
  const child = Bun.spawn({
    cmd: [executable, 'server.js'],
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let output = ''
  const collect = async (stream: ReadableStream<Uint8Array> | undefined): Promise<void> => {
    if (stream === undefined) return
    const decoder = new TextDecoder()
    for await (const chunk of stream) {
      output = (output + decoder.decode(chunk, { stream: true })).slice(-OUTPUT_LIMIT)
    }
  }
  void collect(child.stdout)
  void collect(child.stderr)
  return {
    kill: (signal) => child.kill(signal),
    exited: child.exited,
    output: () => output,
  }
}

export function bunNextServerPorts(): INextServerPorts {
  return {
    spawn: spawnServer,
    freePort,
    ready,
    sleep: (ms) => Bun.sleep(ms),
    now: () => Date.now(),
  }
}

export async function startNextServer({
  root,
  bunPath: executable,
  ports = bunNextServerPorts(),
  timeoutMs = NEXT_SERVER_START_TIMEOUT_MS,
}: {
  root: string
  bunPath: string
  ports?: INextServerPorts
  timeoutMs?: number
}): Promise<INextServer> {
  const port = await ports.freePort()
  const origin = `http://127.0.0.1:${port}`
  const child = ports.spawn({ root, bunPath: executable, port })
  const deadline = ports.now() + timeoutMs
  let exited = false
  void child.exited.then(() => {
    exited = true
  })

  while (ports.now() < deadline) {
    if (await ports.ready(origin)) {
      return {
        origin,
        stop: async () => {
          child.kill('SIGTERM')
          const died = await Promise.race([
            child.exited.then(() => true),
            ports.sleep(STOP_TIMEOUT_MS).then(() => false),
          ])
          if (died) return
          child.kill('SIGKILL')
          await child.exited
        },
      }
    }
    if (exited) {
      throw new Error(`the app server exited before it answered on ${origin}\n${child.output()}`)
    }
    await ports.sleep(POLL_MS)
  }

  child.kill()
  throw new Error(
    `the app server did not answer on ${origin} within ${timeoutMs}ms\n${child.output()}`,
  )
}
