import { chmod, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

import { parseSemver } from '@dltech/atlas-core'

import {
  assetNameFor,
  nextBinaryPathFor,
  shouldStage,
  stagedVersionMarkerPathFor,
  verifySha256,
} from './self-update-asset'

const DOWNLOAD_TIMEOUT_MS = 300_000

export enum EStageOutcome {
  Staged = 'staged',
  AlreadyStaged = 'already-staged',
  Unsupported = 'unsupported',
  Failed = 'failed',
}

export type StageResult =
  | { readonly outcome: EStageOutcome.Staged; readonly version: string }
  | { readonly outcome: EStageOutcome.AlreadyStaged; readonly version: string }
  | { readonly outcome: EStageOutcome.Unsupported }
  | { readonly outcome: EStageOutcome.Failed }

export type SelfUpdatePorts = {
  readonly download: (args: {
    readonly tag: string
    readonly asset: string
    readonly repo: string
    readonly dir: string
  }) => Promise<boolean>
  readonly readFile: (path: string) => Promise<Uint8Array | null>
  readonly writeText: (path: string, text: string) => Promise<void>
  readonly chmod: (path: string, mode: number) => Promise<void>
  readonly rename: (from: string, to: string) => Promise<void>
  readonly remove: (path: string) => Promise<void>
}

const decode = (data: Uint8Array): string => new TextDecoder().decode(data)

async function readStagedVersion(args: {
  markerPath: string
  ports: SelfUpdatePorts
}): Promise<string | null> {
  const raw = await args.ports.readFile(args.markerPath)
  return raw === null ? null : decode(raw).trim()
}

export async function stageUpdate(args: {
  tag: string
  version: string
  repo: string
  execPath: string
  platform: string
  arch: string
  ports: SelfUpdatePorts
}): Promise<StageResult> {
  const targetVersion = parseSemver(args.version)
  if (targetVersion === null) return { outcome: EStageOutcome.Failed }

  const asset = assetNameFor({ platform: args.platform, arch: args.arch })
  if (asset === null) return { outcome: EStageOutcome.Unsupported }

  const nextPath = nextBinaryPathFor(args.execPath)
  const markerPath = stagedVersionMarkerPathFor(args.execPath)

  const stagedVersionText = await readStagedVersion({ markerPath, ports: args.ports })
  const stagedVersion = stagedVersionText === null ? null : parseSemver(stagedVersionText)

  if (stagedVersion !== null && !shouldStage({ stagedVersion, targetVersion })) {
    return { outcome: EStageOutcome.AlreadyStaged, version: stagedVersionText as string }
  }

  const dir = dirname(args.execPath)
  const downloadedPath = `${dir}/${asset}`
  const sidecarPath = `${downloadedPath}.sha256`

  const cleanupDownload = async (): Promise<void> => {
    await args.ports.remove(downloadedPath)
    await args.ports.remove(sidecarPath)
  }

  const ok = await args.ports.download({ tag: args.tag, asset, repo: args.repo, dir })
  if (!ok) {
    await cleanupDownload()
    return { outcome: EStageOutcome.Failed }
  }

  const data = await args.ports.readFile(downloadedPath)
  const sidecar = await args.ports.readFile(sidecarPath)
  if (data === null || sidecar === null) {
    await cleanupDownload()
    return { outcome: EStageOutcome.Failed }
  }

  if (!verifySha256({ data, sidecarText: decode(sidecar) })) {
    await cleanupDownload()
    return { outcome: EStageOutcome.Failed }
  }

  try {
    await args.ports.chmod(downloadedPath, 0o755)
    await args.ports.rename(downloadedPath, nextPath)
    await args.ports.writeText(markerPath, args.version)
  } catch {
    await cleanupDownload()
    return { outcome: EStageOutcome.Failed }
  }

  await args.ports.remove(sidecarPath)

  return { outcome: EStageOutcome.Staged, version: args.version }
}

export function stagedNotice(version: string): string {
  return `atlas v${version} downloaded — /restart to update`
}

export async function readStagedVersionMarker(execPath: string): Promise<string | null> {
  const path = stagedVersionMarkerPathFor(execPath)
  const file = Bun.file(path)
  if (!(await file.exists())) return null

  return (await file.text()).trim()
}

/**
 * Streams rather than buffering: a release binary is ~107MB, and `await res.arrayBuffer()` holds
 * all of it in memory and — worse — can wedge the whole fetch (a hung response never rejects, so
 * the staging lock the caller holds never releases and every other tile gives up at "available").
 * Piping the body to the file caps memory and lets the abort signal actually cut a stalled body.
 */
const downloadAsset = async (args: { url: string; dest: string }): Promise<boolean> => {
  try {
    const res = await fetch(args.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
    if (!res.ok || res.body === null) return false

    await Bun.write(args.dest, res.body)
    return true
  } catch {
    return false
  }
}

export async function downloadReleaseAssets(args: {
  baseUrl: string
  tag: string
  asset: string
  dir: string
}): Promise<boolean> {
  const base = `${args.baseUrl}/${args.tag}`
  const binary = await downloadAsset({ url: `${base}/${args.asset}`, dest: `${args.dir}/${args.asset}` })
  if (!binary) return false

  return downloadAsset({ url: `${base}/${args.asset}.sha256`, dest: `${args.dir}/${args.asset}.sha256` })
}

export function realSelfUpdatePorts(): SelfUpdatePorts {
  return {
    download: ({ tag, asset, repo, dir }) =>
      downloadReleaseAssets({
        baseUrl: `https://github.com/${repo}/releases/download`,
        tag,
        asset,
        dir,
      }),
    readFile: async (path) => {
      const file = Bun.file(path)
      if (!(await file.exists())) return null
      return new Uint8Array(await file.arrayBuffer())
    },
    writeText: async (path, text) => {
      await Bun.write(path, text)
    },
    chmod: (path, mode) => chmod(path, mode),
    rename: (from, to) => rename(from, to),
    remove: (path) => rm(path, { force: true }),
  }
}
