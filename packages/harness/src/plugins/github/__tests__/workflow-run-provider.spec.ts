import { describe, expect, it } from 'bun:test'

import {
  ESubscriptionActor,
  ESubscriptionStatus,
  toThreadId,
  type Subscription,
} from '@dltech/atlas-core'

import type { SubscriptionOccurrence } from '../../../subscriptions/provider'
import { EForge } from '../pure'
import { aCheckout } from '../testing'
import { createWorkflowRunProvider, WORKFLOW_RUN_PROVIDER_KIND } from '../workflow-run-provider'
import type { WorkflowRunReader, WorkflowRunReading } from '../workflow-run-reader'
import { NO_CHECKOUT_ERROR, NOT_GITHUB_ERROR } from '../workflow-run-target'

const THREAD = toThreadId('thread-1')
const REPO = 'github.com/dennisofficial/atlas'
const RUN_ID = 33522901117

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const aRun = (args?: {
  runId?: number
  status?: string
  conclusion?: string
  workflow?: string
  failedJobs?: readonly string[]
}): WorkflowRunReading => {
  const runId = args?.runId ?? RUN_ID
  return {
    runId,
    workflow: args?.workflow ?? 'Build',
    branch: 'main',
    headSha: 'abc123',
    url: `https://github.com/dennisofficial/atlas/actions/runs/${runId}`,
    status: args?.status ?? 'completed',
    conclusion: args?.conclusion ?? 'success',
    ...(args?.failedJobs === undefined ? {} : { failedJobs: args.failedJobs }),
  }
}

const RUNNING = aRun({ status: 'in_progress', conclusion: '' })

type Script = {
  pin?: () => WorkflowRunReading | null
  latest?: () => WorkflowRunReading | null
  selector?: () => readonly WorkflowRunReading[]
}

const scriptedReader = (script: Script) => {
  const pinned: number[] = []

  const reader: WorkflowRunReader = {
    pin: async ({ runId }) => {
      pinned.push(runId)
      return script.pin?.() ?? null
    },
    latest: async () => script.latest?.() ?? null,
    selector: async () => script.selector?.() ?? [],
  }

  return { reader, pinned }
}

const subscription = (args?: { id?: string; target?: unknown }): Subscription => ({
  id: args?.id ?? 'sub-1',
  provider: WORKFLOW_RUN_PROVIDER_KIND,
  target: (args?.target ?? { kind: 'run', repo: REPO, runId: RUN_ID }) as Subscription['target'],
  label: 'dennisofficial/atlas#33522901117',
  threadId: THREAD,
  createdBy: ESubscriptionActor.Agent,
  status: ESubscriptionStatus.Active,
  createdAt: 't',
})

const harness = (args?: {
  script?: Script
  checkout?: ReturnType<typeof aCheckout> | null
  tickMs?: number
}) => {
  const script = args?.script ?? {}
  const scripted = scriptedReader(script)
  const provider = createWorkflowRunProvider({
    tracker: { checkoutFor: () => null },
    reader: scripted.reader,
    probe: async () => (args?.checkout === undefined ? null : args.checkout),
    tickMs: args?.tickMs ?? 1,
  })
  const emitted: SubscriptionOccurrence[] = []
  const started = (options?: Parameters<typeof subscription>[0]) =>
    provider.start({
      subscription: subscription(options),
      emit: (occurrence) => emitted.push(occurrence),
    })

  return { provider, emitted, started, ...scripted }
}

describe('the workflow run provider', () => {
  it('emits once for a pinned run that had already completed, and ends', async () => {
    const { emitted, started, pinned } = harness({ script: { pin: () => aRun() } })

    started()
    await sleep(10)

    expect(emitted).toHaveLength(1)
    const [occurrence] = emitted
    expect(occurrence?.ends).toBe(true)
    expect(occurrence?.key).toBe(`run-wake:${RUN_ID}:success`)
    expect(occurrence?.draft).toMatchObject({
      type: 'run-event',
      repo: REPO,
      workflowRunId: RUN_ID,
      workflow: 'Build',
      branch: 'main',
      url: `https://github.com/dennisofficial/atlas/actions/runs/${RUN_ID}`,
      status: 'completed',
      conclusion: 'success',
      headSha: 'abc123',
      eventId: `run-wake:${RUN_ID}:success`,
    })

    const asked = pinned.length
    await sleep(20)
    expect(pinned.length).toBe(asked)
  })

  it('keeps polling a pinned run that has not completed, then emits its failure with job names', async () => {
    let handed = 0
    const { emitted, started } = harness({
      tickMs: 30,
      script: {
        pin: () => {
          handed += 1
          if (handed === 1) return RUNNING
          return aRun({ conclusion: 'failure', failedJobs: ['lint', 'test'] })
        },
      },
    })

    started()
    await sleep(10)
    expect(emitted).toEqual([])

    await sleep(40)
    expect(emitted).toHaveLength(1)
    expect(emitted[0]?.draft).toMatchObject({
      conclusion: 'failure',
      eventId: `run-wake:${RUN_ID}:failure`,
      failedJobs: ['lint', 'test'],
    })
    expect(emitted[0]?.ends).toBe(true)
  })

  it('gives up after emitting, so a late read cannot notice again', async () => {
    const { emitted, started, pinned } = harness({
      script: { pin: () => aRun({ conclusion: 'cancelled' }) },
    })

    const stop = started()
    await sleep(15)
    stop()

    const asked = pinned.length
    await sleep(20)

    expect(emitted).toHaveLength(1)
    expect(pinned.length).toBe(asked)
  })

  it('ignores a run that had already completed when a selector started, and emits the next completion', async () => {
    let handed = 0
    const { emitted, started } = harness({
      tickMs: 30,
      script: {
        selector: () => {
          handed += 1
          return handed === 1 ? [aRun({ runId: 1 })] : [aRun({ runId: 2 }), aRun({ runId: 1 })]
        },
      },
    })

    started({ target: { kind: 'selector', repo: REPO, workflow: 'deploy.yml', branch: 'main' } })
    await sleep(10)
    expect(emitted).toEqual([])

    await sleep(40)
    expect(emitted).toHaveLength(1)
    expect(emitted[0]?.draft).toMatchObject({ workflowRunId: 2, eventId: 'run-wake:2:success' })
    expect(emitted[0]?.ends).toBe(true)
  })

  it('emits nothing for a target it cannot read', async () => {
    const { emitted, started, pinned } = harness({ script: { pin: () => aRun() } })

    started({ target: { nope: true } })
    await sleep(10)

    expect(emitted).toEqual([])
    expect(pinned).toEqual([])
  })

  it('answers subscribedRun for a live pinned run whatever the branch, and stops once it ends', async () => {
    const { provider, started } = harness({ script: { pin: () => RUNNING } })

    started()
    await sleep(2)

    expect(provider.subscribedRun({ repo: REPO, branch: 'main' })).toBe(true)
    expect(provider.subscribedRun({ repo: 'dennisofficial/atlas', branch: 'other' })).toBe(true)
    expect(provider.subscribedRun({ repo: 'github.com/other/repo', branch: 'main' })).toBe(false)
  })

  it('answers subscribedRun for a selector only on its own branch', async () => {
    const { provider, started } = harness({ script: { selector: () => [] } })

    started({ target: { kind: 'selector', repo: REPO, workflow: 'deploy.yml', branch: 'main' } })
    await sleep(2)

    expect(provider.subscribedRun({ repo: REPO, branch: 'main' })).toBe(true)
    expect(provider.subscribedRun({ repo: REPO, branch: 'release' })).toBe(false)
  })

  it('forgets a subscription it was told to stop', async () => {
    const { provider, started } = harness({ script: { pin: () => RUNNING } })

    const stop = started()
    await sleep(2)
    stop()

    expect(provider.subscribedRun({ repo: REPO, branch: 'main' })).toBe(false)
  })

  it('names the blank form after the newest run for the checkout', async () => {
    const { provider } = harness({
      script: { latest: () => aRun({ workflow: 'Build' }) },
      checkout: aCheckout(),
    })

    const resolved = await provider.resolve({
      input: '',
      threadId: THREAD,
      projectDirectory: '/work/atlas',
    })

    expect(resolved).toEqual({
      target: { kind: 'run', repo: REPO, runId: RUN_ID },
      label: 'dennisofficial/atlas#33522901117 \u00b7 Build',
    })
  })

  it('rejects relative forms on a checkout that is not on github.com', async () => {
    const { provider } = harness({
      checkout: aCheckout({ host: 'gitlab.com', forge: EForge.Other }),
    })

    expect(
      await provider.resolve({ input: '#42', threadId: THREAD, projectDirectory: '/work/atlas' }),
    ).toEqual({ error: NOT_GITHUB_ERROR })
    expect(
      await provider.resolve({ input: '', threadId: THREAD, projectDirectory: '/work/atlas' }),
    ).toEqual({ error: NOT_GITHUB_ERROR })
  })

  it('rejects a relative form with no checkout at all', async () => {
    const { provider } = harness({ checkout: null })

    expect(
      await provider.resolve({ input: '#42', threadId: THREAD, projectDirectory: '/work/atlas' }),
    ).toEqual({ error: NO_CHECKOUT_ERROR })
  })

  it('takes an explicit run id with no checkout and no reader call', async () => {
    const { provider, pinned } = harness({ checkout: null })

    expect(
      await provider.resolve({
        input: 'dennisofficial/atlas#42',
        threadId: THREAD,
        projectDirectory: '/work/atlas',
      }),
    ).toEqual({
      target: { kind: 'run', repo: REPO, runId: 42 },
      label: 'dennisofficial/atlas#42',
    })
    expect(pinned).toEqual([])
  })
})
