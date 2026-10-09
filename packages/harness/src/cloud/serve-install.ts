import type { Sandbox } from '@vercel/sandbox'
import {
  SERVE_BINARY_PATH,
  SERVE_HOME,
  SERVE_PROTOCOL_PATH,
  SERVE_VERSION_PATH,
} from '@dltech/atlas-wire'

import { CHANNEL_PROTOCOL_VERSION } from './channel-wire'

const INSTALL_COMMAND_TIMEOUT_MS = 5 * 60 * 1000

const RELEASE_REPOSITORY = 'dennisofficial/atlas'

const releaseTagOf = (version: string | undefined): string =>
  version === undefined ? 'latest' : `tui-v${version.replace(/^tui-v/, '').replace(/^v/, '')}`

const installScriptUrlOf = (version: string | undefined): string =>
  `https://raw.githubusercontent.com/${RELEASE_REPOSITORY}/${releaseTagOf(version)}/install.sh`

export const serveInstallScript = (args: { version: string | undefined }): string => {
  const version = args.version ?? ''
  const tag = releaseTagOf(args.version)
  const downloadBase =
    args.version === undefined
      ? `https://github.com/${RELEASE_REPOSITORY}/releases/latest/download`
      : `https://github.com/${RELEASE_REPOSITORY}/releases/download/${tag}`
  return [
    'set -eu',
    `_tmp=$(mktemp -d) && trap 'rm -rf "$_tmp"' EXIT`,
    `curl -fsSL "${downloadBase}/atlas-serve-linux-x64" -o "$_tmp/atlas-serve"`,
    `curl -fsSL "${downloadBase}/atlas-serve-linux-x64.sha256" -o "$_tmp/atlas-serve.sha256"`,
    `_expected=$(awk '{print $1}' "$_tmp/atlas-serve.sha256")`,
    `_actual=$(sha256sum "$_tmp/atlas-serve" | awk '{print $1}')`,
    `[ "$_actual" = "$_expected" ] || { echo "atlas-serve sha256 mismatch: got $_actual want $_expected" >&2; exit 1; }`,
    `install -m 0755 "$_tmp/atlas-serve" "${SERVE_BINARY_PATH}.next"`,
    `mv "${SERVE_BINARY_PATH}.next" "${SERVE_BINARY_PATH}"`,
    `printf '%s' '${version}' > "${SERVE_VERSION_PATH}"`,
    `printf '%s' '${CHANNEL_PROTOCOL_VERSION}' > "${SERVE_PROTOCOL_PATH}"`,
  ].join(' && ')
}

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
