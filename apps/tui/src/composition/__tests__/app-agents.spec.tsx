import {
  EAgentStatus,
  toCallId,
  toRunId,
  toThreadId,
  type ProviderIdentity,
} from '@dltech/atlas-core'
import { EKilledBy, type RecoveredAgents } from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import { afterEach, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { HEADING } from '../../ui/components/exit-guard'
import { frameShowing } from '../../ui/__tests__/waiting'
import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { dismissNotice } from '../../ui/notice-store'
import { until } from './app-fixture'
import { App } from '../app'
import { FAKE_CONFIG, fakeApp, scriptedModelPort, type FakeApp } from './fake-app'
import { fakeAgentSnapshot } from './fake-agents'

await grammarsReady()

afterEach(() => dismissNotice())

const THREAD = toThreadId('opened-thread')

const CHILD = toThreadId('thr_child')

const CHILD_INTENT = 'vault audit'

const CHILD_SAID = 'The vault reads its key file exactly once.'

const _PARENT_SAID = 'Delegate the vault audit please.'

const SEEDED = 'what is in here?'

const WIDE = { width: 150, height: 40, exitOnCtrlC: false }

type Mounted = Awaited<ReturnType<typeof testRender>>

const appWith = (): FakeApp =>
  fakeApp({ model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }) })

const child = (
  over: {
    turns?: number
    toolCalls?: number
    status?: EAgentStatus
    lastTool?: string
    model?: ProviderIdentity
  } = {},
) =>
  fakeAgentSnapshot({
    agentId: CHILD,
    spawnedBy: THREAD,
    intent: CHILD_INTENT,
    ...over,
  })

async function seedChildThread(app: FakeApp): Promise<void> {
  await app.threads.create({
    workspace: FAKE_CONFIG.cwd,
    repo: null,
    agent: { spawnedBy: THREAD, type: 'explore' },
  })
  const made = (await app.threads.list({ project: FAKE_CONFIG.cwd })).at(0)
  if (made === undefined) throw new Error('the child thread was not created')

  await app.threads.rename({ threadId: made.id, title: CHILD_INTENT })
  await app.log.append({
    threadId: made.id,
    runId: toRunId('run-child'),
    drafts: [{ type: 'user-said', text: CHILD_SAID }],
  })
}

/**
 * The log is seeded rather than the props alone: a refresh reads the store, so a conversation that
 * exists only in `opened.events` empties out mid-test and falls back to the welcome screen.
 */
async function opened(app: FakeApp): Promise<Mounted> {
  const events = await app.log.append({
    threadId: THREAD,
    runId: toRunId('run-before'),
    drafts: [{ type: 'user-said', text: 'what is in here?' }],
  })
  const setup = await testRender(
    <App app={app} opened={{ threadId: THREAD, events, turns: [], name: null, started: true }} />,
    WIDE,
  )
  await frameShowing({ setup, text: SEEDED })
  return setup
}

describe('a sub-agent in the sidebar', () => {
  it('appears the moment it is spawned, with no interval to wait out', async () => {
    const app = appWith()
    const setup = await opened(app)

    try {
      expect(setup.captureCharFrame()).not.toContain(CHILD_INTENT)

      act(() => app.agents.place(child()))
      await setup.flush()

      expect(setup.captureCharFrame()).toContain(CHILD_INTENT)
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it("shows the child's time on the row, never the tool it is on", async () => {
    const app = appWith()
    await app.log.append({
      threadId: THREAD,
      runId: toRunId('run-parent'),
      drafts: [
        { type: 'user-said', text: 'audit the vault' },
        { type: 'user-said', text: 'and the key file' },
        { type: 'tool-called', callId: toCallId('call_parent'), name: 'read', ordinal: 0 },
      ],
    })
    app.agents.place(child({ turns: 2, toolCalls: 7, lastTool: 'grep' }))

    const setup = await opened(app)

    try {
      const running =
        setup
          .captureCharFrame()
          .split('\n')
          .find((line) => line.includes(CHILD_INTENT)) ?? ''
      expect(running).not.toContain('grep')

      act(() => app.agents.end({ agentId: CHILD }))
      await setup.flush()

      const frame = setup.captureCharFrame()
      const row = frame.split('\n').find((line) => line.includes(CHILD_INTENT)) ?? ''
      expect(row).not.toContain('done')
      expect(row).not.toContain('calls')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('names the model the child runs on a line under its own', async () => {
    const app = appWith()
    app.agents.place(child({ model: { id: 'anthropic', modelId: 'claude-sonnet-5' } }))

    const setup = await opened(app)

    try {
      expect(setup.captureCharFrame()).toContain('sonnet-5')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('stops being live work the moment it ends, without a timer', async () => {
    const app = appWith()
    app.agents.place(child())
    const setup = await opened(app)

    try {
      expect(setup.captureCharFrame()).toContain('SUB-AGENTS  1/1')

      act(() => app.agents.end({ agentId: CHILD }))
      await setup.flush()

      const frame = setup.captureCharFrame()
      expect(frame).toContain('SUB-AGENTS  0/1')
      expect(frame).toContain(`${CHILD_INTENT}`)
      expect(frame.split('\n').find((line) => line.includes(CHILD_INTENT)) ?? '').not.toContain(
        'done',
      )
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('reads how full a child window is off the snapshot the registry already sends', async () => {
    const app = appWith()
    const setup = await opened(app)

    try {
      expect(setup.captureCharFrame()).not.toContain('68.0k')

      act(() => app.agents.place({ ...child(), context: { tokens: 68_000, window: 200_000 } }))
      await setup.flush()

      expect(setup.captureCharFrame()).toContain('68.0k')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('does not show a child to a conversation that did not spawn it', async () => {
    const app = appWith()
    app.agents.place(fakeAgentSnapshot({ agentId: CHILD, spawnedBy: CHILD, intent: CHILD_INTENT }))
    const setup = await opened(app)

    try {
      expect(setup.captureCharFrame()).not.toContain(CHILD_INTENT)
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})

describe('conversations the operator started', () => {
  it('leaves a sub-agent out of /resume', async () => {
    const app = appWith()
    await seedChildThread(app)
    const own = await app.threads.create({ workspace: FAKE_CONFIG.cwd, repo: null })
    await app.threads.rename({ threadId: own.id, title: 'a conversation I started' })

    const setup = await opened(app)

    try {
      await setup.mockInput.typeText('/resume')
      setup.mockInput.pressEnter()

      const frame = await frameShowing({ setup, text: 'a conversation I started' })
      expect(frame).toContain('a conversation I started')
      expect(frame).not.toContain(CHILD_INTENT)
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})

describe('leaving with a child still running', () => {
  it('names it the way the guard names a background shell', async () => {
    const app = appWith()
    app.agents.place(child())
    const setup = await opened(app)

    try {
      setup.mockInput.pressKey('c', { ctrl: true })

      const frame = await frameShowing({ setup, text: HEADING })
      expect(frame).toContain(HEADING)
      expect(frame).toContain('agent')
      expect(frame).toContain(CHILD_INTENT)
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('stops warning once the child has ended', async () => {
    const app = appWith()
    app.agents.place(child())
    const setup = await opened(app)

    try {
      act(() => app.agents.end({ agentId: CHILD, status: EAgentStatus.Stopped }))
      await setup.flush()

      setup.mockInput.pressKey('c', { ctrl: true })
      await setup.flush()
      await settle(200)
      await setup.flush()

      expect(setup.captureCharFrame()).not.toContain(HEADING)
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})

describe('an ending is a wake, not an interrupt', () => {
  it('starts a turn on a parent that was sitting idle', async () => {
    const app = appWith()
    app.agents.place(child())
    const setup = await opened(app)

    try {
      expect(app.turnsDriven).toBe(0)

      act(() => app.agents.end({ agentId: CHILD }))
      await setup.flush()

      expect(await until({ holds: async () => app.turnsDriven === 1, within: 20_000 })).toBe(true)
      expect(app.turnsDriven).toBe(1)
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})

const ORPHAN = toThreadId('thr_orphan')

const ORPHAN_TITLE = 'explore (rotation sweep)'

const LOST: RecoveredAgents = {
  settled: [],
  unlogged: [
    {
      agentId: ORPHAN,
      agentType: 'explore',
      title: ORPHAN_TITLE,
      startedAt: '2026-01-01T09:15:00.000Z',
    },
  ],
}

async function openedWith(app: FakeApp, lost?: RecoveredAgents): Promise<Mounted> {
  const events = await app.log.append({
    threadId: THREAD,
    runId: toRunId('run-before'),
    drafts: [{ type: 'user-said', text: 'what is in here?' }],
  })
  const setup = await testRender(
    <App
      app={app}
      opened={{
        threadId: THREAD,
        events,
        turns: [],
        name: null,
        started: true,
        ...(lost === undefined ? {} : { lost }),
      }}
    />,
    WIDE,
  )
  await frameShowing({ setup, text: SEEDED })
  return setup
}

describe('children the last process lost', () => {
  it('announces an unlogged child on open, because nothing else in the app ever will', async () => {
    const setup = await openedWith(appWith(), LOST)

    try {
      const frame = await frameShowing({
        setup,
        text: '1 sub-agent left no record in this conversation',
      })
      expect(frame).toContain('1 sub-agent left no record in this conversation')
      expect(frame).toContain('check the tree before carrying on')
      expect(frame).not.toContain('/agents')
      expect(frame).not.toContain(ORPHAN_TITLE)
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('shows nothing at all on a clean open, which is every ordinary one', async () => {
    const setup = await openedWith(appWith())

    try {
      const frame = setup.captureCharFrame()
      expect(frame).not.toContain('no record')
      expect(frame).not.toContain('check the tree')
      expect(frame).not.toContain('sub-agent')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  /**
   * The other half of recovery needs no surface of its own: settling writes a real `agent-ended`
   * before the transcript is read, so the row is already in the conversation.
   */
  it('already reads a settled loss out of the transcript, with no notice needed', async () => {
    const app = appWith()
    await app.log.append({
      threadId: THREAD,
      runId: toRunId('run-parent'),
      drafts: [
        {
          type: 'agent-ended',
          agentId: CHILD,
          agentType: 'explore',
          intent: CHILD_INTENT,
          status: EAgentStatus.Stopped,
          killedBy: EKilledBy.Unrecorded,
          prose: 'it read three files',
          turns: 2,
          toolCalls: 7,
        },
      ],
    })

    const events = await app.log.read({ threadId: THREAD })
    const setup = await testRender(
      <App app={app} opened={{ threadId: THREAD, events, turns: [], name: null, started: true }} />,
      WIDE,
    )

    try {
      const frame = await frameShowing({
        setup,
        text: 'was lost before anything recorded how it ended',
      })
      expect(frame).toContain('was lost before anything recorded how it ended')
      expect(frame).toContain('2 turns and 7 tool')
      expect(frame).not.toContain('no record of')
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})
