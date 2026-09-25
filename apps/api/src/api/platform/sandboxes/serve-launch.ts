import type { Sandbox } from '@vercel/sandbox'
import {
  SERVE_BINARY_PATH,
  SERVE_BINARY_SHA256_HEADER,
  SERVE_HEADERS_PATH,
  SERVE_HOME,
  SERVE_LOCK_PATH,
  SERVE_LOG_PATH,
  SERVE_NEXT_BINARY_PATH,
  SERVE_STAMP_PATH,
  SERVE_TOKEN_PATH,
  StaleSandboxTokenError,
} from '@dltech/atlas-wire'

export {
  SERVE_BINARY_PATH,
  SERVE_BINARY_SHA256_HEADER,
  SERVE_HEADERS_PATH,
  SERVE_HOME,
  SERVE_LOCK_PATH,
  SERVE_LOG_PATH,
  SERVE_NEXT_BINARY_PATH,
  SERVE_STAMP_PATH,
  SERVE_TOKEN_PATH,
  StaleSandboxTokenError,
}

const HEALTH_ATTEMPTS = 90
const HEALTH_INTERVAL_SECONDS = 2
const HEALTH_WAIT_TIMEOUT_MS = (HEALTH_ATTEMPTS * HEALTH_INTERVAL_SECONDS + 30) * 1000
const DOWNLOAD_TIMEOUT_MS = 300_000
const QUICK_COMMAND_TIMEOUT_MS = 15_000
const EXIT_AUTH_STALE = 41
const EXIT_HASH_MISMATCH = 42

const withServeToken = (script: string): string =>
  `_serve_token=$(cat ${SERVE_TOKEN_PATH} 2>/dev/null || true); ` +
  `[ -n "$_serve_token" ] && export ATLAS_SERVE_TOKEN="$_serve_token"; true; ${script}`

export const HEALTH_PROBE = withServeToken(
  `curl -sf -m 5 --connect-timeout 2 -H "Authorization: Bearer $ATLAS_SERVE_TOKEN" "http://localhost:$ATLAS_SERVE_PORT/v1/health" -o /dev/null`,
)

const sh = (args: {
  sandbox: Sandbox
  script: string
  timeoutMs?: number
  env?: Record<string, string>
}) =>
  args.sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', args.script],
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
    ...(args.env === undefined ? {} : { env: args.env }),
  })

const serveHealthy = async (sandbox: Sandbox): Promise<boolean> =>
  (await sh({ sandbox, script: HEALTH_PROBE, timeoutMs: QUICK_COMMAND_TIMEOUT_MS })).exitCode === 0

/**
 * Freshness rides with the install rather than with the binary: a compiled binary's sha256 can
 * never equal the source-hash stamp the image build writes, so "is this install current" is
 * answered by a stamp file written at install time, not by re-hashing 109MB on every attach. A
 * sandbox restores its filesystem from a snapshot on resume, so the stamp survives park/wake and
 * a missing one means a genuinely fresh or wiped sandbox, not a parked one.
 */
const installedStamp = async (sandbox: Sandbox): Promise<string> => {
  const read = await sh({
    sandbox,
    script: `cat ${SERVE_STAMP_PATH} 2>/dev/null || true`,
    timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
  })
  return (await read.stdout()).trim()
}

const MATCHING_SERVE = `grep -qa '^${SERVE_BINARY_PATH}' "$pid/cmdline" 2>/dev/null`

const KILL_WEDGED_SERVE = `for pid in /proc/[0-9]*; do
  if ${MATCHING_SERVE}; then kill "\${pid#/proc/}" 2>/dev/null; fi
done
for i in $(seq 10); do
  survivors=0
  for pid in /proc/[0-9]*; do
    if ${MATCHING_SERVE}; then survivors=1; fi
  done
  [ "$survivors" = "0" ] && break
  sleep 0.5
done
for pid in /proc/[0-9]*; do
  if ${MATCHING_SERVE}; then kill -9 "\${pid#/proc/}" 2>/dev/null; fi
done
true`

/**
 * Downloads next to the live binary rather than onto it: `atlas-serve` may still be executing
 * while a deploy changes the stamp, and overwriting an open executable in place fails with
 * ETXTBSY. `-D` captures the response headers (carrying the binary's own sha256) so the download
 * can be verified for integrity before anything is swapped in — see `verifyDownloadedHash` below.
 */
const downloadBinary = withServeToken(
  `mkdir -p ${SERVE_HOME} && ` +
    `code=$(curl -sS --retry 3 --retry-all-errors --connect-timeout 10 -m 240 ` +
    `-D ${SERVE_HEADERS_PATH} ` +
    `-H "Authorization: Bearer $ATLAS_SERVE_TOKEN" ` +
    `"$ATLAS_CLOUD_URL/v1/sandboxes/$ATLAS_THREAD_ID/serve-binary" ` +
    `-o ${SERVE_NEXT_BINARY_PATH} -w '%{http_code}') || exit $?; ` +
    `if [ "$code" = "401" ]; then exit ${EXIT_AUTH_STALE}; fi; ` +
    `if [ "$code" != "200" ]; then echo "download answered HTTP $code" >&2; exit 22; fi`,
)

/** Integrity, not freshness: the downloaded bytes must match what the server actually served. */
const verifyDownloadedHash =
  `expected=$(grep -i "^${SERVE_BINARY_SHA256_HEADER}:" ${SERVE_HEADERS_PATH} 2>/dev/null | tail -1 | cut -d: -f2 | tr -d ' \\r\\n'); ` +
  `if [ -z "$expected" ]; then echo "the download response carried no ${SERVE_BINARY_SHA256_HEADER} header" >&2; exit ${EXIT_HASH_MISMATCH}; fi; ` +
  `hash=$(sha256sum ${SERVE_NEXT_BINARY_PATH} 2>/dev/null | cut -d' ' -f1); ` +
  `if [ "$hash" != "$expected" ]; then ` +
  `echo "downloaded serve binary hash $hash does not match the response header $expected" >&2; ` +
  `exit ${EXIT_HASH_MISMATCH}; fi`

/**
 * `mv` over a running binary replaces the directory entry rather than the open file, so a serve
 * process mid-exec keeps running its own inode until it is killed and relaunched. The stamp file
 * is written in the same step, atomically via a temp file + rename, so a reader never sees a
 * binary and stamp that disagree.
 */
const swapInBinary =
  `mv ${SERVE_NEXT_BINARY_PATH} ${SERVE_BINARY_PATH} && chmod 755 ${SERVE_BINARY_PATH} && ` +
  `printf '%s' "$ATLAS_INSTALL_STAMP" > ${SERVE_STAMP_PATH}.next && mv ${SERVE_STAMP_PATH}.next ${SERVE_STAMP_PATH}`

const serveLogTail = async (sandbox: Sandbox): Promise<string> => {
  const tail = await sh({
    sandbox,
    script: `tail -c 16384 ${SERVE_LOG_PATH} 2>/dev/null || true`,
    timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
  }).catch(() => null)
  if (tail === null) return '<could not read the serve log>'
  const content = (await tail.stdout()).trim()
  return content.length > 0 ? content : '<serve log is empty or missing>'
}

export type ServeLauncher = (args: { sandbox: Sandbox; token?: string }) => Promise<void>

export function createServeLauncher(args: {
  readStamp: () => Promise<string>
}): ServeLauncher {
  return async ({ sandbox, token }) => {
    if (token !== undefined) {
      await sh({
        sandbox,
        script: `mkdir -p ${SERVE_HOME}`,
        timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
      })
      await sandbox.writeFiles([{ path: SERVE_TOKEN_PATH, content: token, mode: 0o600 }])
    }
    const stamp = await args.readStamp()
    const [healthy, installed] = await Promise.all([serveHealthy(sandbox), installedStamp(sandbox)])
    if (healthy && installed === stamp) return
    const stale = installed !== stamp

    if (stale) {
      const downloaded = await sh({ sandbox, script: downloadBinary, timeoutMs: DOWNLOAD_TIMEOUT_MS })
      if (downloaded.exitCode === EXIT_AUTH_STALE) throw new StaleSandboxTokenError()
      if (downloaded.exitCode !== 0) {
        throw new Error(
          `downloading atlas serve into the sandbox failed: ${await downloaded.stderr()}`,
        )
      }
      const verified = await sh({
        sandbox,
        script: verifyDownloadedHash,
        timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
      })
      if (verified.exitCode !== 0) {
        throw new Error(
          `the downloaded atlas serve binary failed verification: ${await verified.stderr()}`,
        )
      }
    }

    await sh({ sandbox, script: KILL_WEDGED_SERVE, timeoutMs: QUICK_COMMAND_TIMEOUT_MS })

    if (stale) {
      const swapped = await sh({
        sandbox,
        script: swapInBinary,
        timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
        env: { ATLAS_INSTALL_STAMP: stamp },
      })
      if (swapped.exitCode !== 0) {
        throw new Error('swapping the verified atlas serve binary into place failed')
      }
    }

    await sandbox.runCommand({
      cmd: 'sh',
      args: [
        '-c',
        withServeToken(
          `exec flock -n ${SERVE_LOCK_PATH} ${SERVE_BINARY_PATH} >> ${SERVE_LOG_PATH} 2>&1`,
        ),
      ],
      detached: true,
    })

    const waited = await sh({
      sandbox,
      script: `for i in $(seq ${HEALTH_ATTEMPTS}); do ${HEALTH_PROBE} && exit 0; sleep ${HEALTH_INTERVAL_SECONDS}; done; exit 1`,
      timeoutMs: HEALTH_WAIT_TIMEOUT_MS,
    })
    if (waited.exitCode !== 0) {
      const tail = await serveLogTail(sandbox)
      throw new Error(
        `atlas serve did not answer /v1/health within ${HEALTH_ATTEMPTS * HEALTH_INTERVAL_SECONDS}s; its log is at ${SERVE_LOG_PATH} in the sandbox, tail:\n${tail}`,
      )
    }
  }
}
