import { artifactUrl, type WebManifest } from './manifest'
import { installedState } from './state'
import type { IPayloadState } from './state'

export interface IWebPayloadFs {
  readState: (home: string) => Promise<IPayloadState>
  writeState: (args: { home: string; state: IPayloadState }) => Promise<void>
  isComplete: (args: { home: string; hash: string }) => boolean
  stage: (args: { home: string; hash: string; archive: Uint8Array }) => Promise<void>
  promote: (args: { home: string; hash: string }) => Promise<void>
  discard: (args: { home: string; hash: string }) => void
  list: (home: string) => string[]
}

export enum EInstallFailure {
  DownloadFailed = 'download-failed',
  SizeMismatch = 'size-mismatch',
  HashMismatch = 'hash-mismatch',
  WriteFailed = 'write-failed',
}

export type TInstallResult =
  | { installed: true; hash: string }
  | { installed: false; reason: EInstallFailure }

export async function installPayload({
  home,
  manifest,
  manifestUrl,
  fs,
  download,
  sha256,
}: {
  home: string
  manifest: WebManifest
  manifestUrl: string
  fs: IWebPayloadFs
  download: (url: string) => Promise<Uint8Array>
  sha256: (bytes: Uint8Array) => string
}): Promise<TInstallResult> {
  const archive = await download(artifactUrl({ manifest, manifestUrl })).catch(() => undefined)
  if (archive === undefined) return { installed: false, reason: EInstallFailure.DownloadFailed }
  if (archive.byteLength !== manifest.size)
    return { installed: false, reason: EInstallFailure.SizeMismatch }
  if (sha256(archive) !== manifest.sha256)
    return { installed: false, reason: EInstallFailure.HashMismatch }

  const state = await fs.readState(home)
  try {
    await fs.stage({ home, hash: manifest.hash, archive })
    await fs.promote({ home, hash: manifest.hash })
  } catch {
    fs.discard({ home, hash: manifest.hash })
    return { installed: false, reason: EInstallFailure.WriteFailed }
  }
  await fs.writeState({ home, state: installedState({ state, hash: manifest.hash }) })
  return { installed: true, hash: manifest.hash }
}
