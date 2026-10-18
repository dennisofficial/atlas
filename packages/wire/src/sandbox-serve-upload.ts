import { randomBytes } from 'node:crypto'
import { open } from 'node:fs/promises'

import type { Sandbox } from '@vercel/sandbox'

import { sandboxSh } from './sandbox-sh.js'
import { serveStageAndStampSteps, type ServeInstaller } from './sandbox-serve-install.js'
import type { DevServeBinary } from './sandbox-sdk.js'
import { SERVE_HOME } from './serve-env.js'

export const DEV_SERVE_VERSION_PREFIX = 'dev-'

/**
 * `@vercel/sandbox` 3.3.0 `writeFiles` gzips the whole tar into one in-memory buffer and sends a
 * single POST, so a full serve binary goes up in parts. 4 MiB per part is the size proven against
 * real Vercel by packages/harness/spikes/live-local-first-smoke.ts.
 */
export const DEV_SERVE_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024
export const DEV_SERVE_UPLOAD_ATTEMPTS = 3

const CHUNK_WRITE_TIMEOUT_MS = 2 * 60 * 1000
const DEFAULT_RETRY_DELAY_MS = 1000
const ASSEMBLE_TIMEOUT_MS = 5 * 60 * 1000
const BYTES_PER_MB = 1024 * 1024

export const isDevServeVersion = (version: string | undefined): boolean =>
  version !== undefined && version.startsWith(DEV_SERVE_VERSION_PREFIX)

export const devServePartPath = (args: { stageDir: string; index: number }): string =>
  `${args.stageDir}/part-${String(args.index).padStart(5, '0')}`

export const devServePartCount = (args: { bytes: number; chunkBytes: number }): number =>
  Math.ceil(args.bytes / args.chunkBytes)

/** Reassembles the uploaded parts, checks size then sha256, and installs through the shared stage/stamp tail. */
export const devServeAssembleScript = (args: {
  binary: DevServeBinary
  stageDir: string
  parts: number
}): string => {
  const assembled = `${args.stageDir}/atlas-serve`
  const partPaths = Array.from(
    { length: args.parts },
    (_unused, index) => `"${devServePartPath({ stageDir: args.stageDir, index })}"`,
  )
  const removeStageDir = `rm -rf "${args.stageDir}"`
  return [
    'set -eu',
    `trap '${removeStageDir}' EXIT`,
    `cat ${partPaths.join(' ')} > "${assembled}"`,
    `_bytes=$(wc -c < "${assembled}" | tr -d ' ')`,
    `[ "$_bytes" = "${args.binary.bytes}" ] || { echo "atlas-serve size mismatch: got $_bytes want ${args.binary.bytes}" >&2; exit 1; }`,
    `_actual=$(sha256sum "${assembled}" | awk '{print $1}')`,
    `[ "$_actual" = "${args.binary.sha256}" ] || { echo "atlas-serve sha256 mismatch: got $_actual want ${args.binary.sha256}" >&2; exit 1; }`,
    ...serveStageAndStampSteps({
      source: assembled,
      version: args.binary.version,
      extraCleanup: removeStageDir,
    }),
  ].join('\n')
}

type UploadLog = ((line: string) => void) | undefined

const megabytesOf = (bytes: number): string => (bytes / BYTES_PER_MB).toFixed(0)

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const writePartWithRetry = async (args: {
  sandbox: Sandbox
  path: string
  content: Uint8Array
  retryDelayMs: number
  log: UploadLog
}): Promise<void> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await args.sandbox.writeFiles([{ path: args.path, content: args.content }], {
        signal: AbortSignal.timeout(CHUNK_WRITE_TIMEOUT_MS),
      })
      return
    } catch (failure) {
      if (attempt >= DEV_SERVE_UPLOAD_ATTEMPTS) {
        throw new Error(
          `uploading ${args.path} failed after ${attempt} attempts: ${messageOf(failure)}`,
        )
      }
      args.log?.(`retrying ${args.path} (attempt ${attempt} failed: ${messageOf(failure)})`)
      await pause(args.retryDelayMs * attempt)
    }
  }
}

const uploadParts = async (args: {
  sandbox: Sandbox
  binary: DevServeBinary
  stageDir: string
  chunkBytes: number
  retryDelayMs: number
  log: UploadLog
}): Promise<number> => {
  const { binary } = args
  const file = await open(binary.path, 'r')
  try {
    const { size } = await file.stat()
    if (size !== binary.bytes) {
      throw new Error(
        `dev serve ${binary.version} at ${binary.path} is ${size} bytes, expected ${binary.bytes}`,
      )
    }
    const parts = devServePartCount({ bytes: size, chunkBytes: args.chunkBytes })
    for (let index = 0; index < parts; index += 1) {
      const chunk = new Uint8Array(Math.min(args.chunkBytes, size - index * args.chunkBytes))
      const { bytesRead } = await file.read({
        buffer: chunk,
        position: index * args.chunkBytes,
      })
      if (bytesRead !== chunk.length) {
        throw new Error(`short read of ${binary.path} at part ${index}: ${bytesRead} bytes`)
      }
      await writePartWithRetry({
        sandbox: args.sandbox,
        path: devServePartPath({ stageDir: args.stageDir, index }),
        content: chunk,
        retryDelayMs: args.retryDelayMs,
        log: args.log,
      })
      const sent = Math.min(size, (index + 1) * args.chunkBytes)
      args.log?.(
        `uploading dev serve ${binary.version}: ${index + 1}/${parts} chunks (${megabytesOf(sent)}/${megabytesOf(size)} MB)`,
      )
    }
    return parts
  } finally {
    await file.close()
  }
}

const runOrThrow = async (args: {
  sandbox: Sandbox
  script: string
  timeoutMs: number
  what: string
}): Promise<void> => {
  const run = await sandboxSh({
    sandbox: args.sandbox,
    script: args.script,
    timeoutMs: args.timeoutMs,
  }).catch((failure: unknown) => {
    throw new Error(`${args.what} failed to run: ${messageOf(failure)}`)
  })
  if (run.exitCode === 0) return
  const stderr = typeof run.stderr === 'function' ? (await run.stderr()).trim() : ''
  throw new Error(`${args.what} failed (exit ${run.exitCode})${stderr === '' ? '' : `: ${stderr}`}`)
}

export const uploadDevServe = async (args: {
  sandbox: Sandbox
  binary: DevServeBinary
  log?: UploadLog
  chunkBytes?: number
  retryDelayMs?: number
}): Promise<void> => {
  const { sandbox, binary } = args
  if (binary.bytes <= 0) throw new Error(`dev serve ${binary.version} is empty`)
  const stageDir = `${SERVE_HOME}/.upload-${randomBytes(6).toString('hex')}`
  args.log?.(
    `uploading dev serve ${binary.version} (${megabytesOf(binary.bytes)} MB) into ${stageDir}`,
  )
  await runOrThrow({
    sandbox,
    script: `mkdir -p "${stageDir}"`,
    timeoutMs: CHUNK_WRITE_TIMEOUT_MS,
    what: `creating ${stageDir}`,
  })
  const parts = await uploadParts({
    sandbox,
    binary,
    stageDir,
    chunkBytes: args.chunkBytes ?? DEV_SERVE_UPLOAD_CHUNK_BYTES,
    retryDelayMs: args.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    log: args.log,
  }).catch(async (failure: unknown) => {
    await sandboxSh({ sandbox, script: `rm -rf "${stageDir}"` }).catch(() => undefined)
    throw failure
  })
  args.log?.(`verifying and installing dev serve ${binary.version}`)
  await runOrThrow({
    sandbox,
    script: devServeAssembleScript({ binary, stageDir, parts }),
    timeoutMs: ASSEMBLE_TIMEOUT_MS,
    what: `atlas-serve ${binary.version} install into the sandbox`,
  })
}

export const uploadServeInstaller =
  (binary: DevServeBinary): ServeInstaller =>
  async ({ sandbox, version, log }) => {
    if (version !== binary.version) {
      throw new Error(
        `the dev serve upload holds ${binary.version} and cannot install ${version ?? 'latest'}`,
      )
    }
    await uploadDevServe({ sandbox, binary, log })
  }
