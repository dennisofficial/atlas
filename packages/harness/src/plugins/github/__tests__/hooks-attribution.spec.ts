import { describe, expect, it } from 'bun:test'

import {
  EShellStatus,
  EToolEffect,
  toCallId,
  toThreadId,
  type EndedShell,
  type ThreadId,
  type ToolCall,
  type ToolOutcome,
} from '@dltech/atlas-core'

import { createFamilyTracker, type FamilyTracker } from '../family-tracker'
import { RefreshPullRequestAfterShellHook, RefreshPullRequestAfterToolHook } from '../hooks'
import { checkoutKey, type RepositoryCheckout } from '../pure'
import type { PullRequestService } from '../pull-request-service'
import { aCheckout } from '../testing'

const NEVER_ABORTED = new AbortController().signal

const THREAD = toThreadId('thread-fixture')
const OTHER_THREAD = toThreadId('thread-other')

const HERE = aCheckout({ directory: '/repo', branch: 'dennis/here' })
const ELSEWHERE = aCheckout({ directory: '/teammate', branch: 'dennis/elsewhere' })

const callOf = (input: unknown): ToolCall => ({
  callId: toCallId('call-1'),
  name: 'bash',
  input,
  effect: EToolEffect.Destructive,
  threadId: THREAD,
})

const SUCCEEDED: ToolOutcome = { ok: true, output: {}, modelText: 'done' }

const endedShell = (command: string): EndedShell => ({
  shellId: 'bash_1',
  command,
  status: EShellStatus.Exited,
  exitCode: 0,
})

const countingService = () => {
  const expected: string[] = []
  const rechecked: string[] = []
  const service = {
    track: () => undefined,
    expectChecks: ({ checkout }: { checkout: RepositoryCheckout }) => {
      expected.push(checkoutKey(checkout))
    },
    recheck: ({ checkout }: { checkout: RepositoryCheckout }) => {
      rechecked.push(checkoutKey(checkout))
    },
  } as unknown as PullRequestService

  return { service, expected: () => expected, rechecked: () => rechecked }
}

const probing =
  (answers: Readonly<Record<string, RepositoryCheckout | null>>) =>
  async ({ directory }: { directory: string }): Promise<RepositoryCheckout | null> =>
    answers[directory] ?? null

const trackerStanding = (
  places: readonly { threadId: ThreadId; checkout: RepositoryCheckout }[],
): FamilyTracker => {
  const tracker = createFamilyTracker({ service: countingService().service })
  for (const place of places) tracker.place(place)
  return tracker
}

describe('the checkout a push is attributed to', () => {
  const shellOf = endedShell

  it('arms only the checkout the command ran in, never another thread’s', async () => {
    const { service, expected } = countingService()
    const hook = new RefreshPullRequestAfterToolHook({
      pullRequests: service,
      probe: probing({ '/repo': HERE, '/teammate': ELSEWHERE }),
    })

    await hook.run({
      call: callOf({ command: 'git push' }),
      result: SUCCEEDED,
      projectDirectory: '/teammate',
      signal: NEVER_ABORTED,
    })

    expect(expected()).toEqual([checkoutKey(ELSEWHERE)])
  })

  it('arms nothing when the directory is not a checkout', async () => {
    const { service, expected, rechecked } = countingService()
    const hook = new RefreshPullRequestAfterToolHook({
      pullRequests: service,
      probe: probing({}),
    })

    await hook.run({
      call: callOf({ command: 'git push' }),
      result: SUCCEEDED,
      projectDirectory: '/nowhere',
      signal: NEVER_ABORTED,
    })

    expect(expected()).toEqual([])
    expect(rechecked()).toEqual([])
  })

  it('attributes a backgrounded push to the thread that started it', async () => {
    const { service, expected } = countingService()
    const hook = new RefreshPullRequestAfterShellHook({
      pullRequests: service,
      tracker: trackerStanding([
        { threadId: THREAD, checkout: HERE },
        { threadId: OTHER_THREAD, checkout: ELSEWHERE },
      ]),
    })

    await hook.run({ threadId: OTHER_THREAD, shell: shellOf('git push') })

    expect(expected()).toEqual([checkoutKey(ELSEWHERE)])
  })

  it('arms nothing for a shell whose thread stands on no checkout', async () => {
    const { service, expected } = countingService()
    const hook = new RefreshPullRequestAfterShellHook({
      pullRequests: service,
      tracker: trackerStanding([{ threadId: THREAD, checkout: HERE }]),
    })

    await hook.run({ threadId: OTHER_THREAD, shell: shellOf('git push') })

    expect(expected()).toEqual([])
  })
})
