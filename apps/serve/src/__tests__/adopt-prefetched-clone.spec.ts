import { describe, expect, it } from 'bun:test'

import { CLONE_PREFETCH_DIR, CLONE_PREFETCH_REPO_DIR } from '@dltech/atlas-wire'

import type { PrefetchAdoptionDeps } from '../adopt-prefetched-clone'
import { EWorkspaceState } from '../materialize-workspace'

import { CWD, harness, revParseAnswers, spec } from './materialize-workspace-fixture'

const depsOf = (result: string | undefined) => {
  const moves: { from: string; to: string }[] = []
  const discarded: string[] = []
  const logs: string[] = []
  const deps: PrefetchAdoptionDeps = {
    waitForResult: async () => result,
    move: async (args) => {
      moves.push(args)
    },
    discard: async (path) => {
      discarded.push(path)
    },
    log: (line) => logs.push(line),
  }
  return { deps, moves, discarded, logs }
}

describe('prefetched clone adoption', () => {
  it('moves the finished clone into the workspace and runs no primary clone', async () => {
    const { deps, moves, discarded } = depsOf('{"ok":true}')
    const { ensure, attempts, emptied } = harness({
      present: [CLONE_PREFETCH_DIR],
      answers: revParseAnswers,
      prefetch: deps,
    })

    const readiness = await ensure({ cwd: CWD, fetchSpec: async () => spec() })

    expect(readiness.state).toBe(EWorkspaceState.Materialized)
    expect(moves).toEqual([{ from: CLONE_PREFETCH_REPO_DIR, to: CWD }])
    expect(attempts.some((one) => one.args[0] === 'clone')).toBe(false)
    expect(attempts.some((one) => one.args[0] === 'rev-parse')).toBe(true)
    expect(emptied).toEqual([CWD])
    expect(discarded).toEqual([CLONE_PREFETCH_DIR])
  })

  it('falls back to cloning when the prefetch failed', async () => {
    const { deps, moves, logs } = depsOf('{"ok":false,"reason":"denied"}')
    const { ensure, attempts } = harness({
      present: [CLONE_PREFETCH_DIR],
      answers: revParseAnswers,
      prefetch: deps,
    })

    const readiness = await ensure({ cwd: CWD, fetchSpec: async () => spec() })

    expect(readiness.state).toBe(EWorkspaceState.Materialized)
    expect(moves).toEqual([])
    expect(attempts.some((one) => one.args[0] === 'clone')).toBe(true)
    expect(logs.join('\n')).toContain('denied')
  })

  it('falls back when the move fails', async () => {
    const { deps } = depsOf('{"ok":true}')
    const { ensure, attempts } = harness({
      present: [CLONE_PREFETCH_DIR],
      answers: revParseAnswers,
      prefetch: {
        ...deps,
        move: async () => {
          throw new Error('EXDEV')
        },
      },
    })

    await ensure({ cwd: CWD, fetchSpec: async () => spec() })

    expect(attempts.some((one) => one.args[0] === 'clone')).toBe(true)
  })

  it('behaves as before when nothing was prefetched', async () => {
    const { deps, moves } = depsOf('{"ok":true}')
    const { ensure, attempts, emptied } = harness({ answers: revParseAnswers, prefetch: deps })

    await ensure({ cwd: CWD, fetchSpec: async () => spec() })

    expect(moves).toEqual([])
    expect(emptied).toEqual([CWD])
    expect(attempts[0]?.args[0]).toBe('clone')
  })
})
