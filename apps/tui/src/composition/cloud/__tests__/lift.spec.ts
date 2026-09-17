import { describe, expect, it } from 'bun:test'

import {
  EExecutionLocation,
  toEventId,
  toRunId,
  type Event,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'
import { CloudError } from '@dltech/atlas-harness'

import { fakeEventLog, fakeThreadStore, type FakeThreadStore } from '../../__tests__/fake-backend'
import { ELiftFault, ELiftStep, liftToCloud, type LiftArgs } from '../lift'
import { CLOUD_NOTICE_KEY, NOTHING_WAS_STOPPED } from '../transition-notice'
import { CLEAN_WORKSPACE, CLOUD_THREAD, fakeBridge, type FakeBridge } from './fixture'

const AT = '2026-09-16T12:00:00.000Z'

let ids = 0

const fakeIds = (): IdPort => ({
  nextThreadId: () => CLOUD_THREAD,
  nextRunId: () => toRunId(`run_${(ids += 1)}`),
  nextEventId: () => {
    throw new Error('unused')
  },
  nextCallId: () => {
    throw new Error('unused')
  },
})

const said = (args: { seq: number; text: string }): Event => ({
  type: 'user-said',
  text: args.text,
  id: toEventId(`event_${args.seq}`),
  seq: args.seq,
  threadId: CLOUD_THREAD,
  runId: toRunId('run_local'),
  depth: 0,
  at: AT,
})

const LOCAL_LOG: readonly Event[] = [
  said({ seq: 1, text: 'take the linter to zero' }),
  said({ seq: 2, text: 'and then ship it' }),
]

type Harness = {
  args: LiftArgs
  bridge: FakeBridge
  localThreads: FakeThreadStore
  readonly located: readonly EExecutionLocation[]
  readonly steps: readonly ELiftStep[]
  readonly stops: number
}

const harness = (over: Partial<LiftArgs> & { bridge?: FakeBridge } = {}): Harness => {
  const bridge = over.bridge ?? fakeBridge()
  const localLog = fakeEventLog([...LOCAL_LOG])
  const localThreads = fakeThreadStore({ log: localLog, existing: [CLOUD_THREAD] })
  const located: EExecutionLocation[] = []
  const steps: ELiftStep[] = []
  let stops = 0

  const args: LiftArgs = {
    threadId: CLOUD_THREAD,
    cwd: '/work',
    events: LOCAL_LOG,
    started: true,
    identity: { workspace: '/work', repo: '/work' },
    title: null,
    bridge,
    localThreads,
    ids: fakeIds(),
    setLocation: (location) => located.push(location),
    stopLocal: async () => {
      stops += 1
      return { shells: ['bun run dev'], services: ['api'] }
    },
    capture: async () => CLEAN_WORKSPACE,
    onProgress: (step) => steps.push(step),
    ...over,
  }

  return {
    args,
    bridge,
    localThreads,
    located,
    steps,
    get stops() {
      return stops
    },
  }
}

describe('lifting a conversation into the cloud', () => {
  it('transfers the log, flips the thread and only then attaches', async () => {
    const test = harness()

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.trail).toEqual(['transfer', 'sandbox', 'attach'])
    expect(test.steps).toEqual([
      ELiftStep.Transferring,
      ELiftStep.Flipping,
      ELiftStep.Stopping,
      ELiftStep.Capturing,
      ELiftStep.Starting,
      ELiftStep.Attaching,
    ])
  })

  it('carries the whole local log across in one batch', async () => {
    const test = harness()

    await liftToCloud(test.args)

    const transferred = test.bridge.log.peek({ threadId: CLOUD_THREAD })
    expect(transferred.filter((event) => event.type === 'user-said').map((event) => event.seq)).toEqual([
      1, 2,
    ])
  })

  it('records the thread as a cloud thread on both sides', async () => {
    const test = harness()

    await liftToCloud(test.args)

    expect(test.located).toEqual([EExecutionLocation.Cloud])
    expect(test.localThreads.chosenLocations).toEqual([
      { threadId: CLOUD_THREAD, location: EExecutionLocation.Cloud },
    ])
  })

  it('attaches to the sandbox the control plane handed back', async () => {
    const test = harness()

    const lifted = await liftToCloud(test.args)
    if (!lifted.ok) throw new Error('expected the lift to succeed')

    expect(test.bridge.attached).toEqual([
      { threadId: CLOUD_THREAD, url: lifted.sandbox.url, token: lifted.sandbox.token },
    ])
  })

  it('sends the git identity and the uncommitted patch with the sandbox request', async () => {
    const dirty = { ...CLEAN_WORKSPACE, patch: 'diff --git a/x b/x\n' }
    const test = harness({ capture: async () => dirty })

    await liftToCloud(test.args)

    expect(test.bridge.created).toEqual([{ threadId: CLOUD_THREAD, workspace: dirty }])
  })

  it('tells the agent it moved, naming what the move closed', async () => {
    const test = harness()

    await liftToCloud(test.args)

    const notice = test.bridge.log
      .peek({ threadId: CLOUD_THREAD })
      .find((event) => event.type === 'context-loaded')
    if (notice === undefined || notice.type !== 'context-loaded') {
      throw new Error('expected a transition notice in the cloud log')
    }

    expect(notice.key).toBe(CLOUD_NOTICE_KEY)
    expect(notice.content).toContain('cloud sandbox')
    expect(notice.content).toContain('bun run dev')
    expect(notice.content).toContain('api')
  })

  it('opens the remote thread for a conversation nobody has spoken in, so the sandbox can attach', async () => {
    const test = harness({ started: false, events: [] })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.trail).toEqual(['transfer', 'sandbox', 'attach'])
    expect(await test.bridge.threads.find({ threadId: CLOUD_THREAD })).toBeDefined()
    expect(test.localThreads.chosenLocations).toEqual([])
  })
})

describe('a lift that does not finish', () => {
  it('leaves the conversation local when the transfer fails, having stopped nothing', async () => {
    const threads = fakeThreadStore()
    const bridge = fakeBridge({ threadStore: threads })
    bridge.stores.threads.createWithFirstEvents = async () => {
      throw new CloudError({ status: 500, message: 'the sessions API fell over' })
    }
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    if (lifted.ok) return

    expect(lifted.fault).toBe(ELiftFault.Transfer)
    expect(lifted.step).toBe(ELiftStep.Transferring)
    expect(lifted.stopped).toEqual(NOTHING_WAS_STOPPED)
    expect(test.located).toEqual([])
    expect(test.stops).toBe(0)
    expect(test.bridge.attached).toEqual([])
  })

  it('puts the conversation back on the host when the sandbox will not start', async () => {
    const bridge = fakeBridge({
      createFails: new CloudError({ status: 500, message: 'no capacity in iad1' }),
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    if (lifted.ok) return

    expect(lifted.fault).toBe(ELiftFault.Sandbox)
    expect(test.located).toEqual([EExecutionLocation.Cloud, EExecutionLocation.Host])
    expect(test.localThreads.chosenLocations.at(-1)).toEqual({
      threadId: CLOUD_THREAD,
      location: EExecutionLocation.Host,
    })
    expect(test.bridge.attached).toEqual([])
  })

  it('reads a 503 from the sandbox routes as the cloud not being set up', async () => {
    const bridge = fakeBridge({
      createFails: new CloudError({ status: 503, message: 'sandboxes are not configured' }),
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    if (lifted.ok) return

    expect(lifted.fault).toBe(ELiftFault.NotConfigured)
    expect(lifted.detail).toContain('no sandbox provider configured')
    expect(lifted.detail).not.toContain('503')
  })

  it('keeps the real message of a 503 that is not the not-configured one', async () => {
    const bridge = fakeBridge({
      createFails: new CloudError({
        status: 503,
        message: 'this deployment has no atlas serve binary at /app/atlas-serve',
      }),
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    if (lifted.ok) return

    expect(lifted.fault).toBe(ELiftFault.Sandbox)
    expect(lifted.detail).toContain('no atlas serve binary')
    expect(lifted.detail).not.toContain('no sandbox provider configured')
  })

  it('reads an unreachable API as unreachable rather than as a refusal', async () => {
    const bridge = fakeBridge({
      createFails: new CloudError({ status: 0, message: 'connect ECONNREFUSED' }),
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    if (lifted.ok) return

    expect(lifted.fault).toBe(ELiftFault.Unreachable)
  })

  it('names what the move already closed when it fails after stopping them', async () => {
    const bridge = fakeBridge({
      createFails: new CloudError({ status: 500, message: 'no capacity' }),
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)
    if (lifted.ok) throw new Error('expected the lift to fail')

    expect(lifted.stopped).toEqual({ shells: ['bun run dev'], services: ['api'] })
  })
})

const threadOf = (store: FakeThreadStore, threadId: ThreadId) => store.find({ threadId })

describe('lifting a thread the cloud already knows', () => {
  it('marks it as cloud rather than transferring it twice', async () => {
    const bridge = fakeBridge()
    await bridge.threads.createWithFirstEvents({
      threadId: CLOUD_THREAD,
      runId: toRunId('run_seed'),
      drafts: [{ type: 'user-said', text: 'already there' }],
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.trail).toEqual(['flip', 'sandbox', 'attach'])
    expect(await threadOf(bridge.threads, CLOUD_THREAD)).toBeDefined()
  })
})

describe('the workspace a lift carries', () => {
  it('reads a 413 as the patch being too large, keeping the advice the API gave', async () => {
    const bridge = fakeBridge({
      createFails: new CloudError({
        status: 413,
        message:
          'The Atlas Cloud API answered POST /v1/sandboxes with 413: the uncommitted patch is 7.2 MiB, over the 5 MiB ceiling — commit or discard some work before lifting.',
      }),
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)
    if (lifted.ok) throw new Error('expected the lift to fail')

    expect(lifted.fault).toBe(ELiftFault.PatchTooLarge)
    expect(lifted.detail).toContain('commit or discard some work')
  })

  it('sends no workspace when there is no repository behind the session', async () => {
    const test = harness({ capture: async () => null })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.created).toEqual([{ threadId: CLOUD_THREAD, workspace: null }])
  })

  it('says so in the transition notice when no repository came with it', async () => {
    const test = harness({ capture: async () => null })

    await liftToCloud(test.args)

    const notice = test.bridge.log
      .peek({ threadId: CLOUD_THREAD })
      .find((event) => event.type === 'context-loaded')
    if (notice === undefined || notice.type !== 'context-loaded') {
      throw new Error('expected a transition notice in the cloud log')
    }

    expect(notice.content).toContain('no git repository')
  })
})
