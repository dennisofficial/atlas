import { randomBytes } from 'node:crypto'

import {
  EServeArch,
  SERVE_HOME,
  serveInstallScript,
  serveStageAndStampSteps,
  type DevServeBinary,
} from '@dltech/atlas-wire'

import { boundedScript, type PodLog, type PodTarget } from './serve-exec'

export type PodServeInstaller = (
  args: PodTarget & { version: string | undefined; log?: PodLog },
) => Promise<void>

const RELEASE_INSTALL_SECONDS = 300
const DEV_INSTALL_SECONDS = 120
const STAGE_SECONDS = 20
const DEV_BINARY_MODE = 0o755

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export const podServeArchOf = (arch?: string): EServeArch => {
  const resolved = arch ?? process.arch
  if (resolved === 'arm64') return EServeArch.Arm64
  if (resolved === 'x64') return EServeArch.X64
  throw new Error(`no atlas-serve build exists for the ${resolved} architecture`)
}

const runBounded = async (args: {
  target: PodTarget
  script: string
  seconds: number
  failureLead: string
}): Promise<void> => {
  const bounded = boundedScript({ script: args.script, seconds: args.seconds })
  const run = await args.target.engine
    .execSh({ id: args.target.id, script: bounded.script, timeoutMs: bounded.timeoutMs })
    .catch((failure: unknown) => {
      throw new Error(`${args.failureLead} failed to run: ${messageOf(failure)}`)
    })
  if (run.exitCode === 0) return
  const stderr = (await run.stderr()).trim()
  throw new Error(
    `${args.failureLead} failed (exit ${run.exitCode})${stderr === '' ? '' : `: ${stderr}`}`,
  )
}

export const releaseServeInstaller =
  (args: { arch: EServeArch }): PodServeInstaller =>
  async ({ engine, id, name, version, log }) => {
    log?.(`downloading atlas-serve ${version ?? 'latest'} into ${SERVE_HOME} of pod ${name}`)
    await runBounded({
      target: { engine, id, name },
      script: `mkdir -p ${SERVE_HOME} && ${serveInstallScript({ version, arch: args.arch })}`,
      seconds: RELEASE_INSTALL_SECONDS,
      failureLead: `atlas-serve ${version ?? 'latest'} install into pod ${name}`,
    })
  }

export const devServeInstaller =
  (binary: DevServeBinary): PodServeInstaller =>
  async ({ engine, id, name, version, log }) => {
    if (version !== binary.version) {
      throw new Error(
        `the dev atlas-serve is "${binary.version}" but the pod was asked for "${version ?? 'latest'}"; refusing to install a different build`,
      )
    }
    const target: PodTarget = { engine, id, name }
    const stageDir = `${SERVE_HOME}/dev-upload.${randomBytes(6).toString('hex')}`
    const staged = `${stageDir}/atlas-serve`
    log?.(`uploading dev atlas-serve ${binary.version} (${binary.bytes} bytes) into pod ${name}`)

    const removeStage = () =>
      runBounded({
        target,
        script: `rm -rf "${stageDir}"`,
        seconds: STAGE_SECONDS,
        failureLead: `removing ${stageDir} in pod ${name}`,
      }).catch(() => undefined)

    try {
      await runBounded({
        target,
        script: `mkdir -p "${stageDir}"`,
        seconds: STAGE_SECONDS,
        failureLead: `staging ${stageDir} in pod ${name}`,
      })
      await engine.writeFile({
        id,
        path: staged,
        content: await Bun.file(binary.path).bytes(),
        mode: DEV_BINARY_MODE,
      })
      await runBounded({
        target,
        script: [
          `_bytes=$(wc -c < "${staged}" | tr -d ' ')`,
          `[ "$_bytes" = "${binary.bytes}" ] || { echo "atlas-serve size mismatch: got $_bytes want ${binary.bytes}" >&2; exit 1; }`,
          `_actual=$(sha256sum "${staged}" | awk '{print $1}')`,
          `[ "$_actual" = "${binary.sha256}" ] || { echo "atlas-serve sha256 mismatch: got $_actual want ${binary.sha256}" >&2; exit 1; }`,
          ...serveStageAndStampSteps({
            source: staged,
            version: binary.version,
            extraCleanup: `rm -rf "${stageDir}"`,
          }),
        ].join(' && '),
        seconds: DEV_INSTALL_SECONDS,
        failureLead: `dev atlas-serve ${binary.version} install into pod ${name}`,
      })
    } catch (failure) {
      await removeStage()
      throw failure
    }
  }
