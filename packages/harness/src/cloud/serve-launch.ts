import type { Sandbox } from '@vercel/sandbox'

import {
  SERVE_BINARY_PATH,
  SERVE_HOME,
  SERVE_LOCK_PATH,
  SERVE_LOG_PATH,
  SERVE_NEXT_BINARY_PATH,
  SERVE_STAMP_PATH,
  SERVE_TOKEN_PATH,
} from '@dltech/atlas-wire'

export {
  SERVE_BINARY_PATH,
  SERVE_HOME,
  SERVE_LOCK_PATH,
  SERVE_LOG_PATH,
  SERVE_NEXT_BINARY_PATH,
  SERVE_STAMP_PATH,
  SERVE_TOKEN_PATH,
}

const HEALTH_ATTEMPTS = 90
const HEALTH_INTERVAL_SECONDS = 2
const HEALTH_WAIT_TIMEOUT_MS = (HEALTH_ATTEMPTS * HEALTH_INTERVAL_SECONDS + 30) * 1000
const QUICK_COMMAND_TIMEOUT_MS = 15_000

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
 * The pushed binary lands next to the live one rather than onto it: `atlas-serve` may still be
 * executing while the laptop pushes a fresh build, and overwriting an open executable in place
 * fails with ETXTBSY.
 */
const verifyPushedHash = `hash=$(sha256sum ${SERVE_NEXT_BINARY_PATH} 2>/dev/null | cut -d' ' -f1); if [ "$hash" != "$ATLAS_EXPECTED_SHA256" ]; then echo "the pushed serve binary hashes to $hash, not the local file $ATLAS_EXPECTED_SHA256" >&2; exit 1; fi`

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

export type ServeStamps = {
  /** Written as the install stamp when a fresh binary is pushed in place of a stale baked one. */
  install: string
  /** What the installed stamp may hold to count as current — the baked image's `source:<sha>` stamps. */
  acceptable: readonly string[]
}

/**
 * The stamps this build trusts, computed on the laptop: `sources` names the logical stamps the
 * baked image's serve may carry — `bun build --compile` is not reproducible, so a baked serve can
 * never be recognized by binary hash, only by the source build the image was cut from. Nothing is
 * read from the control plane; the serve baked into the image is version-locked to this release.
 */
export function serveStampsReader(args: {
  sources?: readonly string[] | undefined
}): () => Promise<ServeStamps> {
  const acceptable = [...(args.sources ?? [])]
  return async () => ({ install: acceptable[0] ?? '', acceptable })
}

export function createServeLauncher(args: {
  readStamps: () => Promise<ServeStamps>
  /**
   * The laptop's own serve build, read only when the sandbox's baked serve is stale: it is pushed
   * straight onto the drive with `writeFiles` — safe off-container; the #485 OOM was a
   * memory-capped API container doing the same call server-side. `undefined` leaves the launcher
   * no fallback for a stale bake, which it says rather than guesses around.
   */
  readServeBinary?: (() => Promise<{ bytes: Uint8Array; sha256: string } | undefined>) | undefined
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
    const stamps = await args.readStamps()
    const [healthy, installed] = await Promise.all([serveHealthy(sandbox), installedStamp(sandbox)])
    const fresh = stamps.acceptable.includes(installed)
    if (healthy && fresh) return
    const stale = !fresh

    if (stale) {
      const binary = await args.readServeBinary?.()
      if (binary === undefined) {
        throw new Error(
          'no compatible atlas serve is baked into this sandbox and no fresh binary was supplied to push',
        )
      }
      await sandbox.writeFiles([{ path: SERVE_NEXT_BINARY_PATH, content: binary.bytes }])
      const verified = await sh({
        sandbox,
        script: verifyPushedHash,
        timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
        env: { ATLAS_EXPECTED_SHA256: binary.sha256 },
      })
      if (verified.exitCode !== 0) {
        throw new Error(
          `the pushed atlas serve binary failed verification: ${await verified.stderr()}`,
        )
      }
    }

    await sh({ sandbox, script: KILL_WEDGED_SERVE, timeoutMs: QUICK_COMMAND_TIMEOUT_MS })

    if (stale) {
      const swapped = await sh({
        sandbox,
        script: swapInBinary,
        timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
        env: { ATLAS_INSTALL_STAMP: stamps.install },
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
