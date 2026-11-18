import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EChangeSide, type CallOp, type ChangesContent } from '@dltech/atlas-protocol'
import type { CallContext } from '@dltech/atlas-protocol/engine'
import { afterEach, describe, expect, it } from 'bun:test'

import { changesGroup } from '..'
import type { DaemonOpsDeps } from '../../deps'

const made: string[] = []

const dir = (): string => {
  const made_ = mkdtempSync(join(tmpdir(), 'atlas-changes-read-'))
  made.push(made_)
  return made_
}

const git = (cwd: string, argv: readonly string[]): string =>
  execFileSync('git', ['-C', cwd, ...argv], { encoding: 'utf8' })

const read = async (args: {
  repoPath: string
  base: string
  path: string
  side: EChangeSide
}): Promise<ChangesContent> => {
  const deps: DaemonOpsDeps = { env: { PATH: process.env.PATH }, home: tmpdir() }
  const group = changesGroup(deps)({ publish: () => undefined })
  const registered = group.ops.find((candidate) => candidate.op === 'changes.read')
  if (registered === undefined) throw new Error('no changes.read op')
  const ctx: CallContext = {
    key: 'k',
    signal: new AbortController().signal,
    output: () => undefined,
    publish: () => undefined,
  }
  const op: CallOp = {
    op: 'changes.read',
    repoPath: args.repoPath,
    base: args.base,
    path: args.path,
    oldPath: null,
    side: args.side,
  }
  return (await registered.run({ op, ctx })) as ChangesContent
}

afterEach(() => {
  for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('changes.read', () => {
  it('round trips both sides byte for byte', async () => {
    const repoPath = dir()
    git(repoPath, ['init', '-q', '-b', 'main'])
    const before = 'alpha\nbeta\n'
    const after = 'alpha\nbeta\ngamma\n'
    writeFileSync(join(repoPath, 'file.txt'), before)
    git(repoPath, ['add', '-A'])
    git(repoPath, ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'one'])
    const base = git(repoPath, ['rev-parse', 'HEAD']).trim()
    writeFileSync(join(repoPath, 'file.txt'), after)

    const baseSide = await read({ repoPath, base, path: 'file.txt', side: EChangeSide.Base })
    const currentSide = await read({ repoPath, base, path: 'file.txt', side: EChangeSide.Current })

    expect(Buffer.from(baseSide.base64, 'base64').toString('utf8')).toBe(before)
    expect(Buffer.from(currentSide.base64, 'base64').toString('utf8')).toBe(after)
    expect(baseSide.size).toBe(before.length)
    expect(currentSide.size).toBe(after.length)
    expect(baseSide.hash).not.toBe(currentSide.hash)
  })
})
