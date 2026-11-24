import type { Sandbox } from '@vercel/sandbox'
import { CHANNEL_PROTOCOL_VERSION } from './channel-wire.js'
import {
  SERVE_BINARY_PATH,
  SERVE_HOME,
  SERVE_PROTOCOL_PATH,
  SERVE_VERSION_PATH,
} from './serve-env.js'

export enum EServeArch {
  X64 = 'x64',
  Arm64 = 'arm64',
}

const INSTALL_COMMAND_TIMEOUT_MS = 5 * 60 * 1000

const RELEASE_REPOSITORY = 'dennisofficial/atlas'

const RELEASE_MIRROR = 'https://install.byatlas.io'

const releaseTagOf = (version: string | undefined): string =>
  version === undefined ? 'latest' : `tui-v${version.replace(/^tui-v/, '').replace(/^v/, '')}`

const CURL_RETRY_FLAGS = '--retry 3 --retry-connrefused --retry-delay 1 --connect-timeout 10'

const curlOf = (target: string): string => `curl -fsSL ${CURL_RETRY_FLAGS} ${target}`

export const serveInstallScript = (args: {
  version: string | undefined
  arch?: EServeArch
}): string => {
  const version = args.version ?? ''
  const asset = `atlas-serve-linux-${args.arch ?? EServeArch.X64}`
  const tag = releaseTagOf(args.version)
  const releasePath =
    args.version === undefined ? 'releases/latest/download' : `releases/download/${tag}`
  const downloadBase = `${RELEASE_MIRROR}/${releasePath}`
  const fallbackBase = `https://github.com/${RELEASE_REPOSITORY}/${releasePath}`
  return [
    'set -eu',
    `_tmp=$(mktemp -d) && trap 'rm -rf "$_tmp"' EXIT`,
    `_get() { { ${curlOf('"$1" -o "$_tmp/atlas-serve"')} & _bin=$!; ${curlOf('"$2" -o "$_tmp/atlas-serve.sha256"')} & _sum=$!; wait $_bin || { kill $_sum 2>/dev/null; wait $_sum 2>/dev/null || true; echo "atlas-serve download failed" >&2; return 1; }; wait $_sum || { echo "atlas-serve checksum download failed" >&2; return 1; }; } }`,
    `{ _get "${downloadBase}/${asset}" "${downloadBase}/${asset}.sha256" || _get "${fallbackBase}/${asset}" "${fallbackBase}/${asset}.sha256"; }`,
    `_expected=$(awk '{print $1}' "$_tmp/atlas-serve.sha256")`,
    `_actual=$(sha256sum "$_tmp/atlas-serve" | awk '{print $1}')`,
    `[ "$_actual" = "$_expected" ] || { echo "atlas-serve sha256 mismatch: got $_actual want $_expected" >&2; exit 1; }`,
    ...serveStageAndStampSteps({
      source: '$_tmp/atlas-serve',
      version,
      extraCleanup: 'rm -rf "$_tmp"',
    }),
  ].join(' && ')
}

/** The install tail shared by every serve installer: atomic per-process stage, rename, and both stamps. */
export const serveStageAndStampSteps = (args: {
  source: string
  version: string
  extraCleanup?: string
}): string[] => [
  // Two wakes can race the install on the same sandbox: a shared staging name means one
  // installer's `install` trips on the other's leftover. Stage per-process, then rename — the
  // rename is atomic, so the live binary is never half-written no matter how the race lands.
  `_stage="${SERVE_BINARY_PATH}.next.$$"`,
  `trap '${args.extraCleanup === undefined ? '' : `${args.extraCleanup}; `}rm -f "$_stage"' EXIT`,
  `install -m 0755 "${args.source}" "$_stage"`,
  `mv -f "$_stage" "${SERVE_BINARY_PATH}"`,
  `printf '%s' '${args.version}' > "${SERVE_VERSION_PATH}"`,
  `printf '%s' '${CHANNEL_PROTOCOL_VERSION}' > "${SERVE_PROTOCOL_PATH}"`,
]

export type ServeInstaller = (args: {
  sandbox: Sandbox
  version: string | undefined
  log?: ((line: string) => void) | undefined
}) => Promise<void>

export const installServe: ServeInstaller = async ({ sandbox, version, log }) => {
  log?.(
    `downloading atlas-serve ${version ?? 'latest'} into ${SERVE_HOME} from ${releaseTagOf(version)}`,
  )
  const run = await sandbox
    .runCommand({
      cmd: 'sh',
      args: ['-c', `mkdir -p ${SERVE_HOME} && ${serveInstallScript({ version })}`],
      timeoutMs: INSTALL_COMMAND_TIMEOUT_MS,
    })
    .catch((failure: unknown) => {
      throw new Error(
        `atlas-serve download failed to run: ${failure instanceof Error ? failure.message : String(failure)}`,
      )
    })
  if (run.exitCode !== 0) {
    const stderr = typeof run.stderr === 'function' ? (await run.stderr()).trim() : ''
    throw new Error(
      `atlas-serve ${version ?? 'latest'} failed to install into the sandbox (exit ${run.exitCode})${stderr === '' ? '' : `: ${stderr}`}`,
    )
  }
}
