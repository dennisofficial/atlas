import { createHash } from 'node:crypto'
import type { Sandbox } from '@vercel/sandbox'

export const SERVE_BINARY_PATH = '/vercel/sandbox/atlas-serve'
export const SERVE_STAMP_PATH = '/vercel/sandbox/atlas-serve.sha256'
export const SERVE_LOG_PATH = '/vercel/sandbox/atlas-serve.log'

const HEALTH_ATTEMPTS = 90
const HEALTH_INTERVAL_SECONDS = 2
const HEALTH_WAIT_TIMEOUT_MS = (HEALTH_ATTEMPTS * HEALTH_INTERVAL_SECONDS + 30) * 1000

export const HEALTH_PROBE = `curl -sf -H "Authorization: Bearer $ATLAS_SERVE_TOKEN" "http://localhost:$ATLAS_SERVE_PORT/v1/health" -o /dev/null`

const sh = (args: { sandbox: Sandbox; script: string; timeoutMs?: number }) =>
  args.sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', args.script],
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
  })

const serveHealthy = async (sandbox: Sandbox): Promise<boolean> =>
  (await sh({ sandbox, script: HEALTH_PROBE })).exitCode === 0

const installedStamp = async (sandbox: Sandbox): Promise<string> => {
  const read = await sh({ sandbox, script: `cat ${SERVE_STAMP_PATH} 2>/dev/null || true` })
  return (await read.stdout()).trim()
}

const sha256Of = (content: Uint8Array): string =>
  createHash('sha256').update(content).digest('hex')

const KILL_WEDGED_SERVE = `for pid in /proc/[0-9]*; do
  if grep -qa 'atlas-serv[e]' "$pid/cmdline" 2>/dev/null; then kill "\${pid#/proc/}" 2>/dev/null; fi
done
true`

export type ServeLauncher = (sandbox: Sandbox) => Promise<void>

export function createServeLauncher(args: {
  readBinary: () => Promise<Uint8Array>
}): ServeLauncher {
  return async (sandbox) => {
    if (await serveHealthy(sandbox)) return

    const binary = await args.readBinary()
    if ((await installedStamp(sandbox)) !== sha256Of(binary)) {
      await sandbox.writeFiles([
        { path: SERVE_BINARY_PATH, content: binary, mode: 0o755 },
        { path: SERVE_STAMP_PATH, content: sha256Of(binary) },
      ])
    }

    await sh({ sandbox, script: KILL_WEDGED_SERVE })

    await sandbox.runCommand({
      cmd: 'sh',
      args: ['-c', `exec ${SERVE_BINARY_PATH} >> ${SERVE_LOG_PATH} 2>&1`],
      detached: true,
    })

    const waited = await sh({
      sandbox,
      script: `for i in $(seq ${HEALTH_ATTEMPTS}); do ${HEALTH_PROBE} && exit 0; sleep ${HEALTH_INTERVAL_SECONDS}; done; exit 1`,
      timeoutMs: HEALTH_WAIT_TIMEOUT_MS,
    })
    if (waited.exitCode !== 0) {
      throw new Error(
        `atlas serve did not answer /v1/health within ${HEALTH_ATTEMPTS * HEALTH_INTERVAL_SECONDS}s; its log is at ${SERVE_LOG_PATH} in the sandbox`,
      )
    }
  }
}
