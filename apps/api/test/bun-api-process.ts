import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'

const API_ROOT = path.resolve(import.meta.dirname, '..')
const STARTUP_TIMEOUT_MS = 60_000

export type ProcessExit = { code: number | null; signal: NodeJS.Signals | null }

export type BunApiProcess = {
  baseUrl: string
  output: () => string
  exited: Promise<ProcessExit>
  kill: () => Promise<void>
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address === null || typeof address === 'string') {
          reject(new Error('could not reserve a free TCP port'))
          return
        }
        resolve(address.port)
      })
    })
  })
}

export async function startBunApi({
  databaseUrl,
  args = ['src/main.ts'],
  readyPattern = /Nest application successfully started/,
  extraEnv = {},
}: {
  databaseUrl: string
  args?: string[]
  readyPattern?: RegExp
  extraEnv?: Record<string, string>
}): Promise<BunApiProcess> {
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`

  const child = spawn('bun', args, {
    cwd: API_ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: 'test',
      PORT: String(port),
      DATABASE_URL: databaseUrl,
      APP_TIER: 'local',
      SECRET_KEY: 'bundle-spec-throwaway-secret-with-32-chars',
      WEB_ORIGIN: 'http://localhost:3001',
      BETTER_AUTH_URL: baseUrl,
      SECRETS_ENCRYPTION_KEY: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      TRIGGER_SECRET_KEY: 'tr_dev_test-fixture-not-a-real-key',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  const collect = (chunk: Buffer): void => {
    output += chunk.toString()
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)

  const exited = new Promise<ProcessExit>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })

  const kill = async (): Promise<void> => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
  }

  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`API did not log readiness within ${STARTUP_TIMEOUT_MS}ms`)),
      STARTUP_TIMEOUT_MS,
    )
    const onData = (): void => {
      if (!readyPattern.test(output)) return
      clearTimeout(timer)
      resolve()
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    void exited.then(({ code, signal }) => {
      clearTimeout(timer)
      reject(new Error(`API exited before it was ready (code=${code}, signal=${signal})`))
    })
  })

  try {
    await ready
  } catch (error) {
    await kill()
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`${reason}\n--- bun ${args.join(' ')} output ---\n${output}`)
  }

  return { baseUrl, output: () => output, exited, kill }
}
