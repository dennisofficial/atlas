import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const BINARY_PATH = '/usr/local/bin/cloudflared'
const LOCK_PATH = '/opt/atlas/cloudflared.lock'
const PID_PATH = '/opt/atlas/cloudflared.pid'
const TOKEN_HASH_PATH = '/opt/atlas/cloudflared.token-sha256'
const STOP_TIMEOUT_MS = 5_000
const LOG_PATH = '/opt/atlas/cloudflared.log'
const REGISTERED_MARKER = 'Registered tunnel connection'
const READY_TIMEOUT_MS = 20_000
const POLL_INTERVAL_MS = 250
const LOG_TAIL_CHARS = 800

export const MISSING_BINARY_MESSAGE =
  "this pod's image has no cloudflared, so its ports cannot be published — start a new thread to get a current pod"

const RUN_SCRIPT = `echo $$ > ${PID_PATH}; exec cloudflared tunnel --no-autoupdate run`
const LAUNCH_SCRIPT = `flock -n ${LOCK_PATH} sh -c '${RUN_SCRIPT}' >> ${LOG_PATH} 2>&1`

export type CloudflaredHost = {
  binaryExists: () => boolean
  isRunning: () => boolean
  storedTokenHash: () => string | undefined
  stopRunning: () => Promise<void>
  launch: (args: { token: string }) => void
  readLog: () => string
  now: () => number
  sleep: (ms: number) => Promise<void>
}

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

export const launchEnv = (args: {
  token: string
  parentEnv: NodeJS.ProcessEnv
}): Record<string, string> => ({
  ...(args.parentEnv.PATH === undefined ? {} : { PATH: args.parentEnv.PATH }),
  ...(args.parentEnv.HOME === undefined ? {} : { HOME: args.parentEnv.HOME }),
  TUNNEL_TOKEN: args.token,
})

const readPid = (): number | undefined => {
  try {
    const pid = Number.parseInt(readFileSync(PID_PATH, 'utf8').trim(), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : undefined
  } catch {
    return undefined
  }
}

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export const createSystemCloudflaredHost = (
  deps: { spawnFn: typeof spawn; writeFile: (path: string, data: string) => void } = {
    spawnFn: spawn,
    writeFile: writeFileSync,
  },
): CloudflaredHost => ({
  binaryExists: () => existsSync(BINARY_PATH),
  isRunning: () => {
    const pid = readPid()
    return pid !== undefined && pidAlive(pid)
  },
  storedTokenHash: () => {
    try {
      return readFileSync(TOKEN_HASH_PATH, 'utf8').trim()
    } catch {
      return undefined
    }
  },
  stopRunning: async () => {
    const pid = readPid()
    if (pid === undefined) return
    const signalAndWait = async (signal: NodeJS.Signals) => {
      try {
        process.kill(pid, signal)
      } catch {
        return
      }
      const deadline = Date.now() + STOP_TIMEOUT_MS
      while (pidAlive(pid) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      }
    }
    await signalAndWait('SIGTERM')
    if (pidAlive(pid)) await signalAndWait('SIGKILL')
  },
  launch: ({ token }) => {
    deps.writeFile(TOKEN_HASH_PATH, hashToken(token))
    deps
      .spawnFn('setsid', ['nohup', 'sh', '-c', LAUNCH_SCRIPT], {
        detached: true,
        stdio: 'ignore',
        env: launchEnv({ token, parentEnv: process.env }),
      })
      .unref()
  },
  readLog: () => {
    try {
      return readFileSync(LOG_PATH, 'utf8')
    } catch {
      return ''
    }
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
})

export const systemCloudflaredHost: CloudflaredHost = createSystemCloudflaredHost()

export const ensureCloudflared = async (args: {
  token: string
  host?: CloudflaredHost | undefined
}): Promise<void> => {
  const host = args.host ?? systemCloudflaredHost
  if (!host.binaryExists()) throw new Error(MISSING_BINARY_MESSAGE)
  const expectedHash = hashToken(args.token)
  const runningWithCurrentToken = () => host.isRunning() && host.storedTokenHash() === expectedHash
  if (runningWithCurrentToken()) return
  if (host.isRunning()) await host.stopRunning()

  const logOffset = host.readLog().length
  host.launch({ token: args.token })
  const deadline = host.now() + READY_TIMEOUT_MS
  while (host.now() < deadline) {
    if (host.readLog().slice(logOffset).includes(REGISTERED_MARKER)) return
    if (runningWithCurrentToken()) return
    await host.sleep(POLL_INTERVAL_MS)
  }
  const tail = host.readLog().slice(-LOG_TAIL_CHARS)
  throw new Error(
    `cloudflared did not register a tunnel connection within ${READY_TIMEOUT_MS / 1000}s; log tail: ${tail}`,
  )
}
