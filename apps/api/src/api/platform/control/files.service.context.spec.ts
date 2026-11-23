import { describe, expect, it } from 'bun:test'
import { ECallStatus, EFilesRoot, type CallOp } from '@dltech/atlas-protocol'

import {
  asUser,
  CHECKOUT_ROOT,
  listing,
  opsOf,
  setupFiles,
  stageCheckout,
} from './files.service.fixture'

const contextRootOf = (sessionId: string): string => `/atlas/home/sessions/${sessionId}/context`

const textStat = {
  status: ECallStatus.Ok,
  op: 'stat' as const,
  value: { size: 9, mode: 0, mtimeMs: 0, isFile: true, isDirectory: false },
} as const

describe('FilesService with the context root', () => {
  it('lists the context folder instead of any checkout', async () => {
    const seen: CallOp[] = []
    const { plane, files, sessions } = setupFiles(opsOf([listing(['plan.md'])], seen))
    const sessionId = await asUser(sessions)
    await stageCheckout({
      plane,
      sessionId,
      checkoutId: 'c1',
      worktreePath: CHECKOUT_ROOT,
      updatedAt: 1,
      paths: ['src/a.ts'],
    })

    const output = await files.tree({
      userId: 'user-a',
      sessionId,
      directory: '',
      checkoutId: 'c1',
      root: EFilesRoot.Context,
    })

    expect(seen[0]).toEqual({ op: 'readDirectory', path: contextRootOf(sessionId) })
    expect(output.entries).toEqual([{ name: 'plan.md', isDirectory: false, changed: false }])
  })

  it('lists a subdirectory of the context folder', async () => {
    const seen: CallOp[] = []
    const { files, sessions } = setupFiles(opsOf([listing(['notes.md'])], seen))
    const sessionId = await asUser(sessions)

    await files.tree({
      userId: 'user-a',
      sessionId,
      directory: 'sections',
      root: EFilesRoot.Context,
    })

    expect(seen[0]).toEqual({
      op: 'readDirectory',
      path: `${contextRootOf(sessionId)}/sections`,
    })
  })

  it('reads a context file', async () => {
    const seen: CallOp[] = []
    const { files, sessions } = setupFiles(
      opsOf([textStat, { status: ECallStatus.Ok, op: 'readFile', value: '# Plan' }], seen),
    )
    const sessionId = await asUser(sessions)

    const output = await files.read({
      userId: 'user-a',
      sessionId,
      path: 'plan.md',
      root: EFilesRoot.Context,
    })

    expect(seen).toEqual([
      { op: 'stat', path: `${contextRootOf(sessionId)}/plan.md` },
      { op: 'readFile', path: `${contextRootOf(sessionId)}/plan.md` },
    ])
    expect(output).toEqual({
      file: { type: 'text', path: 'plan.md', content: '# Plan', truncated: false, bytes: 9 },
    })
  })

  it('refuses a context path that escapes the folder without reaching the pod', async () => {
    const seen: CallOp[] = []
    const { files, sessions } = setupFiles(opsOf([], seen))
    const sessionId = await asUser(sessions)

    await expect(
      files.read({ userId: 'user-a', sessionId, path: '../secret', root: EFilesRoot.Context }),
    ).rejects.toThrow('path outside the checkout')
    expect(seen).toEqual([])
  })
})
