import { describe, expect, it } from 'bun:test'
import { ECallStatus, type CallOp } from '@dltech/atlas-protocol'
import {
  asUser,
  CHECKOUT_ROOT as ROOT,
  listing,
  opsOf,
  setupFiles,
  stageCheckout,
} from './files.service.fixture'

describe('FilesService with a checkout', () => {
  it('lists the checkout root and keeps the directory relative', async () => {
    const seen: CallOp[] = []
    const { plane, files, sessions } = setupFiles(opsOf([listing(['src'])], seen))
    const sessionId = await asUser(sessions)
    await stageCheckout({
      plane,
      sessionId,
      checkoutId: 'c1',
      worktreePath: ROOT,
      updatedAt: 1,
      paths: [],
    })

    const output = await files.tree({
      userId: 'user-a',
      sessionId,
      directory: '',
      checkoutId: 'c1',
    })

    expect(seen[0]).toEqual({ op: 'readDirectory', path: ROOT })
    expect(output.directory).toBe('')
  })

  it('lists a subdirectory of the checkout', async () => {
    const seen: CallOp[] = []
    const { plane, files, sessions } = setupFiles(opsOf([listing(['a.ts'])], seen))
    const sessionId = await asUser(sessions)
    await stageCheckout({
      plane,
      sessionId,
      checkoutId: 'c1',
      worktreePath: ROOT,
      updatedAt: 1,
      paths: [],
    })

    const output = await files.tree({
      userId: 'user-a',
      sessionId,
      directory: 'src',
      checkoutId: 'c1',
    })

    expect(seen[0]).toEqual({ op: 'readDirectory', path: `${ROOT}/src` })
    expect(output.directory).toBe('src')
  })

  it('refuses a directory that escapes the checkout without reaching the pod', async () => {
    const seen: CallOp[] = []
    const { plane, files, sessions } = setupFiles(opsOf([listing([])], seen))
    const sessionId = await asUser(sessions)
    await stageCheckout({
      plane,
      sessionId,
      checkoutId: 'c1',
      worktreePath: ROOT,
      updatedAt: 1,
      paths: [],
    })

    await expect(
      files.tree({ userId: 'user-a', sessionId, directory: '../..', checkoutId: 'c1' }),
    ).rejects.toThrow('path outside the checkout')
    expect(seen).toEqual([])
  })

  it('refuses an absolute directory outside the checkout', async () => {
    const seen: CallOp[] = []
    const { plane, files, sessions } = setupFiles(opsOf([listing([])], seen))
    const sessionId = await asUser(sessions)
    await stageCheckout({
      plane,
      sessionId,
      checkoutId: 'c1',
      worktreePath: ROOT,
      updatedAt: 1,
      paths: [],
    })

    await expect(
      files.tree({ userId: 'user-a', sessionId, directory: '/etc', checkoutId: 'c1' }),
    ).rejects.toThrow('path outside the checkout')
    expect(seen).toEqual([])
  })

  it('refuses an unknown checkout', async () => {
    const seen: CallOp[] = []
    const { files, sessions } = setupFiles(opsOf([listing([])], seen))
    const sessionId = await asUser(sessions)

    await expect(
      files.tree({ userId: 'user-a', sessionId, directory: '', checkoutId: 'gone' }),
    ).rejects.toThrow('unknown checkout')
    expect(seen).toEqual([])
  })

  it('marks the changed files of the named checkout only', async () => {
    const { plane, files, sessions } = setupFiles(opsOf([listing(['new.ts', 'old.ts'])]))
    const sessionId = await asUser(sessions)
    await stageCheckout({
      plane,
      sessionId,
      checkoutId: 'c1',
      worktreePath: ROOT,
      updatedAt: 1,
      paths: ['old.ts'],
    })
    await stageCheckout({
      plane,
      sessionId,
      checkoutId: 'c2',
      worktreePath: '/atlas/workspaces/app-next',
      updatedAt: 2,
      paths: ['new.ts'],
    })

    const output = await files.tree({
      userId: 'user-a',
      sessionId,
      directory: '',
      checkoutId: 'c1',
    })

    expect(output.entries.map((entry) => [entry.name, entry.changed])).toEqual([
      ['new.ts', false],
      ['old.ts', true],
    ])
  })

  it('marks from the newest row when a worktree holds two checkout ids', async () => {
    const { plane, files, sessions } = setupFiles(opsOf([listing(['new.ts', 'old.ts'])]))
    const sessionId = await asUser(sessions)
    await stageCheckout({
      plane,
      sessionId,
      checkoutId: 'legacy',
      worktreePath: ROOT,
      updatedAt: 1,
      paths: ['old.ts'],
    })
    await stageCheckout({
      plane,
      sessionId,
      checkoutId: 'fresh',
      worktreePath: ROOT,
      updatedAt: 2,
      paths: ['new.ts'],
    })

    const output = await files.tree({ userId: 'user-a', sessionId, directory: '' })

    expect(output.entries.map((entry) => [entry.name, entry.changed])).toEqual([
      ['new.ts', true],
      ['old.ts', false],
    ])
  })

  it('searches inside the checkout root', async () => {
    const seen: CallOp[] = []
    const { plane, files, sessions } = setupFiles(
      opsOf([{ status: ECallStatus.Ok, op: 'glob', value: ['src/a.ts'] }], seen),
    )
    const sessionId = await asUser(sessions)
    await stageCheckout({
      plane,
      sessionId,
      checkoutId: 'c1',
      worktreePath: ROOT,
      updatedAt: 1,
      paths: [],
    })

    await files.search({ userId: 'user-a', sessionId, query: 'a', checkoutId: 'c1' })

    expect(seen[0]).toEqual({ op: 'glob', pattern: '**/*a*', cwd: ROOT, dot: false })
  })

  it('reads the absolute path and returns the relative one', async () => {
    const seen: CallOp[] = []
    const { plane, files, sessions } = setupFiles(
      opsOf(
        [
          {
            status: ECallStatus.Ok,
            op: 'stat',
            value: { size: 10, mode: 0, mtimeMs: 0, isFile: true, isDirectory: false },
          },
          { status: ECallStatus.Ok, op: 'readFile', value: 'export {}' },
        ],
        seen,
      ),
    )
    const sessionId = await asUser(sessions)
    await stageCheckout({
      plane,
      sessionId,
      checkoutId: 'c1',
      worktreePath: ROOT,
      updatedAt: 1,
      paths: [],
    })

    expect(
      await files.read({ userId: 'user-a', sessionId, path: 'src/a.ts', checkoutId: 'c1' }),
    ).toEqual({
      file: { type: 'text', path: 'src/a.ts', content: 'export {}', truncated: false, bytes: 10 },
    })
    expect(seen).toEqual([
      { op: 'stat', path: `${ROOT}/src/a.ts` },
      { op: 'readFile', path: `${ROOT}/src/a.ts` },
    ])
  })

  it('refuses a read path that escapes the checkout', async () => {
    const seen: CallOp[] = []
    const { plane, files, sessions } = setupFiles(opsOf([], seen))
    const sessionId = await asUser(sessions)
    await stageCheckout({
      plane,
      sessionId,
      checkoutId: 'c1',
      worktreePath: ROOT,
      updatedAt: 1,
      paths: [],
    })

    await expect(
      files.read({ userId: 'user-a', sessionId, path: '../secret', checkoutId: 'c1' }),
    ).rejects.toThrow('path outside the checkout')
    expect(seen).toEqual([])
  })
})
