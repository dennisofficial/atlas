import { describe, expect, it } from 'bun:test'

import { EWorktreeExit, type ToolCall } from '@dltech/atlas-core'

import { worktreeTrackHook } from '..'

const call = {
  callId: 'c1',
  name: 'enter_worktree',
  effect: 'write',
  input: {},
  threadId: 't1',
} as unknown as ToolCall

const run = (result: Parameters<typeof worktreeTrackHook.run>[0]['result']) =>
  worktreeTrackHook.run({
    call,
    result,
    projectDirectory: '/work',
    signal: new AbortController().signal,
  })

describe('the crew worktree tracker', () => {
  it('turns an entered worktree into the foundation event', async () => {
    const outcome = await run({
      ok: true,
      output: {
        enteredWorktree: {
          path: '/work/.atlas/worktrees/dennis/wt',
          branch: 'dennis/wt',
          base: 'origin/main',
          adopted: false,
        },
      },
      modelText: 'created',
    })

    expect(outcome.drafts).toEqual([
      {
        type: 'worktree-entered',
        path: '/work/.atlas/worktrees/dennis/wt',
        branch: 'dennis/wt',
        base: 'origin/main',
        adopted: false,
      },
    ])
  })

  it('turns an exited worktree into the other foundation event', async () => {
    const outcome = await run({
      ok: true,
      output: {
        exitedWorktree: {
          path: '/work/.atlas/worktrees/dennis/wt',
          action: EWorktreeExit.Keep,
          returnTo: '/work',
        },
      },
      modelText: 'left',
    })

    expect(outcome.drafts).toEqual([
      {
        type: 'worktree-exited',
        path: '/work/.atlas/worktrees/dennis/wt',
        action: EWorktreeExit.Keep,
        returnTo: '/work',
      },
    ])
  })

  it('leaves every other result alone', async () => {
    expect(await run({ ok: true, output: { lines: 3 }, modelText: 'read' })).toEqual({})
    expect(await run({ ok: false, reason: 'no such tool' })).toEqual({})
  })
})
