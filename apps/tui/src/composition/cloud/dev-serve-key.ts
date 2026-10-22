import { join } from 'node:path'

import { DEV_SERVE_VERSION_PREFIX } from '@dltech/atlas-wire'

export enum ELinuxServeTarget {
  X64 = 'bun-linux-x64',
  Arm64 = 'bun-linux-arm64',
}

export type UntrackedFile = { readonly path: string; readonly sha256: string }

export type DevServeSource = {
  readonly head: string
  readonly diff: string
  readonly untracked: readonly UntrackedFile[]
}

export type DevServeSourceProbe = (args: { repo: string }) => Promise<DevServeSource | null>

const UNREADABLE = 'unreadable'

export function devServeKeyOf(args: { source: DevServeSource; target: ELinuxServeTarget }): string {
  const { source, target } = args
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(`target\0${target}\0head\0${source.head}\0diff\0`)
  hasher.update(source.diff)
  hasher.update('\0untracked\0')
  const untracked = [...source.untracked].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  )
  for (const file of untracked) hasher.update(`${file.path}\0${file.sha256}\0`)
  return hasher.digest('hex')
}

export function devServeCacheKeyOf(args: {
  source: DevServeSource
  target: ELinuxServeTarget
}): string {
  return devServeKeyOf(args).slice(0, 16)
}

export function devServePinOf(binarySha256: string): string {
  return `${DEV_SERVE_VERSION_PREFIX}${binarySha256.slice(0, 12)}`
}

const git = async (args: { repo: string; argv: readonly string[] }): Promise<string | null> => {
  const proc = Bun.spawn(['git', '-C', args.repo, ...args.argv], {
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const text = await new Response(proc.stdout).text()
  return (await proc.exited) === 0 ? text : null
}

const fileSha256 = async (path: string): Promise<string> => {
  try {
    const hasher = new Bun.CryptoHasher('sha256')
    for await (const chunk of Bun.file(path).stream()) hasher.update(chunk)
    return hasher.digest('hex')
  } catch {
    return UNREADABLE
  }
}

export const probeDevServeSource: DevServeSourceProbe = async ({ repo }) => {
  const head = await git({ repo, argv: ['rev-parse', 'HEAD'] })
  if (head === null) return null

  const diff = await git({ repo, argv: ['diff', '--no-color', '--no-ext-diff', 'HEAD'] })
  if (diff === null) return null

  const listing = await git({ repo, argv: ['ls-files', '--others', '--exclude-standard', '-z'] })
  if (listing === null) return null

  const paths = listing.split('\0').filter((path) => path.length > 0)
  const untracked = await Promise.all(
    paths.map(async (path) => ({ path, sha256: await fileSha256(join(repo, path)) })),
  )
  return { head: head.trim(), diff, untracked }
}
