import type { Sandbox } from '@vercel/sandbox'

export const SERVE_BINARY_PATH = '/vercel/sandbox/atlas-serve'
export const SERVE_STAMP_PATH = '/vercel/sandbox/atlas-serve.sha256'
export const SERVE_LOG_PATH = '/vercel/sandbox/atlas-serve.log'

const HEALTH_ATTEMPTS = 90
const HEALTH_INTERVAL_SECONDS = 2
const HEALTH_WAIT_TIMEOUT_MS = (HEALTH_ATTEMPTS * HEALTH_INTERVAL_SECONDS + 30) * 1000
const DOWNLOAD_TIMEOUT_MS = 300_000

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

const KILL_WEDGED_SERVE = `for pid in /proc/[0-9]*; do
  if grep -qa 'atlas-serv[e]' "$pid/cmdline" 2>/dev/null; then kill "\${pid#/proc/}" 2>/dev/null; fi
done
true`

const downloadBinary = (stamp: string): string =>
  `curl -sfS -H "Authorization: Bearer $ATLAS_SERVE_TOKEN" ` +
  `"$ATLAS_CLOUD_URL/v1/sandboxes/$ATLAS_THREAD_ID/serve-binary" -o ${SERVE_BINARY_PATH} ` +
  `&& chmod 755 ${SERVE_BINARY_PATH} ` +
  `&& printf '%s' '${stamp}' > ${SERVE_STAMP_PATH}`

export type ServeLauncher = (sandbox: Sandbox) => Promise<void>

export function createServeLauncher(args: {
  readStamp: () => Promise<string>
}): ServeLauncher {
  return async (sandbox) => {
    if (await serveHealthy(sandbox)) return

    const stamp = await args.readStamp()
    if ((await installedStamp(sandbox)) !== stamp) {
      const downloaded = await sh({
        sandbox,
        script: downloadBinary(stamp),
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
      })
      if (downloaded.exitCode !== 0) {
        throw new Error(
          `downloading atlas serve into the sandbox failed: ${await downloaded.stderr()}`,
        )
      }
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
