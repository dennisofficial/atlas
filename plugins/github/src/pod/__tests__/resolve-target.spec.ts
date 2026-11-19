import { describe, expect, it } from 'bun:test'

import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { ECallStatus, EExecOutcome } from '@dltech/atlas-protocol'

import { NO_PULL_REQUEST_ERROR, NO_REPOSITORY_ERROR } from '../../core'
import { resolveTarget } from '../resolve-target'

const ghFailingWith = (text: string): Pick<PluginPodContext, 'call'> => ({
  call: async (_op, options) => {
    options?.onOutput?.(new TextEncoder().encode(text))
    return {
      status: ECallStatus.Ok,
      op: 'exec',
      value: { exitCode: 1, signal: null, outcome: EExecOutcome.Exited, outputBytes: text.length },
    }
  },
})

describe('resolveTarget', () => {
  it("gives gh's reason when it cannot name the checkout's repository", async () => {
    const reason = 'fatal: not a git repository (or any of the parent directories): .git'

    expect(
      await resolveTarget({
        ctx: ghFailingWith(reason),
        input: '#2390',
        cwd: '/work/.atlas/worktrees/wt',
      }),
    ).toEqual({ error: `${NO_REPOSITORY_ERROR} (${reason})` })
  })

  it("gives gh's reason when the checkout has no pull request", async () => {
    const reason = 'no pull requests found for branch "main"'

    expect(await resolveTarget({ ctx: ghFailingWith(reason), input: '' })).toEqual({
      error: `${NO_PULL_REQUEST_ERROR} (${reason})`,
    })
  })
})
