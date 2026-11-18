import { createHash } from 'node:crypto'
import { lstat, readFile, readlink } from 'node:fs/promises'
import { join } from 'node:path'

import { CallFailureError, ECallFailure } from '@dltech/atlas-protocol'

import { ManagedProcess } from '../../process/managed'
import type { DaemonOpsDeps } from '../deps'
import { runGit } from '../git/git'

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

const BASE_CANDIDATES = ['origin/main', 'origin/master', 'main', 'master'] as const

export type ResolvedSide = { bytes: Uint8Array; hash: string; size: number }

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const sideOfBytes = (bytes: Uint8Array): ResolvedSide => ({
  bytes,
  hash: createHash('sha256').update(bytes).digest('hex'),
  size: bytes.byteLength,
})

const runGitBytes = async (args: {
  deps: DaemonOpsDeps
  repoPath: string
  argv: readonly string[]
}): Promise<Uint8Array | null> => {
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let child: ManagedProcess
  try {
    child = ManagedProcess.spawn({
      cmd: ['git', '-C', args.repoPath, ...args.argv],
      env: { ...args.deps.env, GIT_OPTIONAL_LOCKS: '0' },
      onStdout: (bytes) => stdout.push(Buffer.from(bytes)),
      onStderr: (bytes) => stderr.push(Buffer.from(bytes)),
    })
  } catch (error) {
    throw new CallFailureError({
      code: ECallFailure.SpawnFailed,
      message: `git could not start: ${messageOf(error)}`,
    })
  }
  const exit = await child.exit()
  return exit.exitCode === 0 ? Buffer.concat(stdout) : null
}

const gitMaybe = async (args: {
  deps: DaemonOpsDeps
  repoPath: string
  argv: readonly string[]
}): Promise<string | null> => {
  try {
    return await runGit({ deps: args.deps, repoPath: args.repoPath, argv: args.argv })
  } catch (error) {
    if (error instanceof CallFailureError && error.failure.code === ECallFailure.SpawnFailed)
      throw error
    return null
  }
}

export const resolveBase = async (args: {
  deps: DaemonOpsDeps
  repoPath: string
  base: string | null
}): Promise<string | null> => {
  if (args.base !== null) return args.base
  const symbolic = await gitMaybe({
    deps: args.deps,
    repoPath: args.repoPath,
    argv: ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
  })
  const named = symbolic?.trim() ?? ''
  const candidates = named === '' ? [...BASE_CANDIDATES] : [named, ...BASE_CANDIDATES]
  for (const candidate of candidates) {
    const merged = await gitMaybe({
      deps: args.deps,
      repoPath: args.repoPath,
      argv: ['merge-base', 'HEAD', candidate],
    })
    const sha = merged?.trim() ?? ''
    if (sha !== '') return sha
  }
  const head = await gitMaybe({
    deps: args.deps,
    repoPath: args.repoPath,
    argv: ['rev-parse', 'HEAD'],
  })
  const sha = head?.trim() ?? ''
  return sha === '' ? null : sha
}

export const baseSide = async (args: {
  deps: DaemonOpsDeps
  repoPath: string
  ref: string
  path: string
}): Promise<ResolvedSide | null> => {
  const bytes = await runGitBytes({
    deps: args.deps,
    repoPath: args.repoPath,
    argv: ['cat-file', 'blob', `${args.ref}:${args.path}`],
  })
  return bytes === null ? null : sideOfBytes(bytes)
}

export const currentSide = async (args: {
  repoPath: string
  path: string
}): Promise<ResolvedSide | 'directory' | null> => {
  const full = join(args.repoPath, args.path)
  try {
    const info = await lstat(full)
    if (info.isDirectory()) return 'directory'
    if (info.isSymbolicLink()) return sideOfBytes(new TextEncoder().encode(await readlink(full)))
    return sideOfBytes(new Uint8Array(await readFile(full)))
  } catch {
    return null
  }
}
