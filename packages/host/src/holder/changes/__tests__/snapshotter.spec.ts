import { FakeChangeContentStore } from '@dltech/atlas-control/testing'
import { EChangeFileStatus } from '@dltech/atlas-protocol'
import { describe, expect, it } from 'bun:test'

import { changeCheckoutId } from '../identity'
import type { ChangesCheckout } from '../snapshotter'
import {
  BASE,
  bytesOf,
  REPO,
  rig,
  SECOND_WORKTREE,
  SESSION,
  sha,
  singleFile,
  until,
  WORKTREE,
} from './snapshotter-rig'

describe('ChangesSnapshotter', () => {
  it('uploads only the missing hashes once and leaves an identical snapshot alone', async () => {
    const state = singleFile()
    const { snapshotter, content, writes, plane, calls, errors } = await rig({ state })

    await snapshotter.snapshotNow()
    expect(errors).toEqual([])
    const before = bytesOf('one\n')
    expect(content.puts).toEqual([sha(before), sha(bytesOf('one\ntwo\n'))])
    expect(writes).toHaveLength(1)
    const [checkout] = await plane.readChanges({ sessionId: SESSION })
    expect(checkout?.checkoutId).toBe(
      changeCheckoutId({ sessionId: SESSION, repo: REPO, worktreePath: WORKTREE }),
    )
    expect(checkout?.repo).toBe(REPO)
    expect(checkout?.base).toBe(BASE)
    expect(checkout?.files[0]).toMatchObject({
      path: 'a.txt',
      status: EChangeFileStatus.Modified,
      size: 8,
    })

    await snapshotter.snapshotNow()
    expect(content.puts).toHaveLength(2)
    expect(writes).toHaveLength(1)
    calls.close()
  })

  it('writes and notifies nothing when the content store rejects the upload', async () => {
    class FailingStore extends FakeChangeContentStore {
      override put(): Promise<void> {
        return Promise.reject(new Error('bucket is down'))
      }
    }
    const state = singleFile()
    const { snapshotter, writes, plane, calls } = await rig({ state, content: new FailingStore() })

    await snapshotter.snapshotNow()

    expect(writes).toHaveLength(0)
    expect(await plane.readChanges({ sessionId: SESSION })).toHaveLength(0)
    calls.close()
  })

  it('replaces the file rows when the worktree loses its only change', async () => {
    const state = singleFile()
    const { snapshotter, plane, writes, calls } = await rig({ state })

    await snapshotter.snapshotNow()
    state.manifest = { repoPath: WORKTREE, base: BASE, files: [] }
    await snapshotter.snapshotNow()

    expect(writes).toHaveLength(2)
    const [checkout] = await plane.readChanges({ sessionId: SESSION })
    expect(checkout?.files).toEqual([])
    calls.close()
  })

  it('re-arms the watch and writes a second row when a worktree appears', async () => {
    const state = singleFile()
    let paths: readonly string[] = [WORKTREE]
    const { snapshotter, plane, writes, watchRoots, calls } = await rig({
      state,
      checkouts: async () =>
        paths.map((repoPath) => ({
          repoPath,
          originUrl: 'git@github.com:org/repo.git',
          base: BASE,
        })),
    })

    snapshotter.start()
    await until(() => watchRoots.length === 1 && writes.length === 1)
    paths = [WORKTREE, SECOND_WORKTREE]
    snapshotter.rearm()

    await until(() => watchRoots.some((roots) => roots.length === 2))
    await until(() => writes.length === 2)

    expect(watchRoots[0]).toEqual([WORKTREE])
    expect(watchRoots[watchRoots.length - 1]).toEqual([WORKTREE, SECOND_WORKTREE])
    const rows = await plane.readChanges({ sessionId: SESSION })
    expect(rows.map((row) => row.worktreePath).sort()).toEqual([WORKTREE, SECOND_WORKTREE])
    calls.close()
  })

  it('coalesces a second request into one queued scan instead of running two at once', async () => {
    const state = singleFile()
    const { snapshotter, calls } = await rig({ state })
    let open: () => void = () => undefined
    state.gate = () =>
      new Promise<void>((resolve) => {
        open = resolve
      })

    const first = snapshotter.snapshotNow()
    const second = snapshotter.snapshotNow()
    await until(() => state.scans === 1)
    state.gate = undefined
    open()
    await first
    await second
    await until(() => state.scans === 2)

    expect(state.scans).toBe(2)
    expect(state.peak).toBe(1)
    calls.close()
  })

  it('never arms the watch after stop when discovery resolves late', async () => {
    const state = singleFile()
    let release: (checkouts: readonly ChangesCheckout[]) => void = () => undefined
    let asked = 0
    const deferred = new Promise<readonly ChangesCheckout[]>((resolve) => {
      release = resolve
    })
    const { snapshotter, calls, ops } = await rig({
      state,
      checkouts: () => {
        asked += 1
        return deferred
      },
    })

    snapshotter.start()
    await until(() => asked > 0)
    const stopped = snapshotter.stop()
    release([{ repoPath: WORKTREE, originUrl: 'git@github.com:org/repo.git', base: BASE }])
    await stopped

    const stopAt = ops.lastIndexOf('watch.stop')
    expect(stopAt).toBeGreaterThanOrEqual(0)
    expect(ops.slice(stopAt)).not.toContain('watch.start')
    expect(ops).not.toContain('watch.start')
    calls.close()
  })
})
