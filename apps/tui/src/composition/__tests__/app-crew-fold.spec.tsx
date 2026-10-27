import { EAgentStatus, toRunId, toThreadId } from '@dltech/atlas-core'
import { type AgentSnapshot } from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import { act } from 'react'

import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { App } from '../app'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'
import { fakeAgentSnapshot } from './fake-agents'

await grammarsReady()

const THREAD = toThreadId('opened-thread')

const WIDE = { width: 150, height: 40, exitOnCtrlC: false }

type Mounted = Awaited<ReturnType<typeof testRender>>

const LONG_AGO = '2020-01-01T00:00:00.000Z'

const CHILD_SAID = 'The vault reads its key file exactly once.'

const appWith = (): FakeApp =>
  fakeApp({ model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }) })

const settled = (args: {
  agentId: string
  intent: string
  status?: EAgentStatus
  agentType?: string
}): AgentSnapshot => ({
  ...fakeAgentSnapshot({
    agentId: args.agentId,
    intent: args.intent,
    status: args.status ?? EAgentStatus.Finished,
    toolCalls: 3,
    ...(args.agentType === undefined ? {} : { agentType: args.agentType }),
  }),
  endedAt: LONG_AGO,
})

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
  await setup.flush()
  await settle(250)
  await setup.flush()
  return setup
}

const doneSubagents = (count: number): readonly AgentSnapshot[] =>
  Array.from({ length: count }, (_, at) =>
    settled({ agentId: `thr_done_${at}`, intent: `audit ${at}` }),
  )

describe('the one fold rule in the sidebar', () => {
  it('folds even a lone finished child, with nothing to wait out', async () => {
    const app = appWith()
    const setup = await opened(app)

    try {
      act(() => app.agents.place(settled({ agentId: 'thr_read', intent: 'consumed audit' })))
      await setup.flush()

      const frame = setup.captureCharFrame()
      expect(frame).not.toContain('consumed audit')
      expect(frame).toContain('✓ 1 done')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('folds every settled child into one count, never leaving a tail', async () => {
    const app = appWith()
    const setup = await opened(app)

    try {
      act(() => {
        for (const child of doneSubagents(5)) app.agents.place(child)
      })
      await setup.flush()

      const frame = setup.captureCharFrame()
      expect(frame).toContain('✓ 5 done')
      expect(frame).not.toContain('audit 4')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('counts failed and stopped apart and omits what is zero', async () => {
    const app = appWith()
    const setup = await opened(app)

    try {
      act(() => {
        app.agents.place(
          settled({ agentId: 'thr_f', intent: 'broken', status: EAgentStatus.Failed }),
        )
        for (const child of doneSubagents(2)) app.agents.place(child)
      })
      await setup.flush()

      expect(setup.captureCharFrame()).toContain('✓ 2 done · ✗ 1 failed')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('keeps a running child beside the fold line', async () => {
    const app = appWith()
    const setup = await opened(app)

    try {
      act(() => {
        app.agents.place(fakeAgentSnapshot({ agentId: 'thr_live', intent: 'live audit' }))
        for (const child of doneSubagents(5)) app.agents.place(child)
      })
      await setup.flush()

      const frame = setup.captureCharFrame()
      expect(frame).toContain('live audit')
      expect(frame).toMatch(/AGENTS\s+1 running/)
      expect(frame).toContain('✓ 5 done')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('expands the folded rows from the fold line', async () => {
    const app = appWith()
    const setup = await opened(app)

    try {
      act(() => {
        for (const child of doneSubagents(2)) app.agents.place(child)
      })
      await setup.flush()
      const rows = setup.captureCharFrame().split('\n')
      const y = rows.findIndex((line) => line.includes('2 done'))
      const x = (rows[y] ?? '').indexOf('2 done')

      await act(async () => {
        await setup.mockMouse.click(x, y)
      })
      await setup.flush()

      const frame = setup.captureCharFrame()
      expect(frame).toContain('▾')
      expect(frame).toContain('audit 0')
      expect(frame).toContain('audit 1')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('skips a folded child on ctrl+g', async () => {
    const app = appWith()
    await app.log.append({
      threadId: toThreadId('thr_done_0'),
      runId: toRunId('run-child'),
      drafts: [{ type: 'assistant-said', parts: [{ type: 'text', text: CHILD_SAID }] }],
    })
    const setup = await opened(app)

    try {
      act(() => {
        for (const child of doneSubagents(2)) app.agents.place(child)
      })
      await setup.flush()

      setup.mockInput.pressKey('g', { ctrl: true })
      await setup.flush()
      await settle(250)
      await setup.flush()

      expect(setup.captureCharFrame()).not.toContain(CHILD_SAID)
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('never folds a teammate', async () => {
    const app = appWith()
    const setup = await opened(app)

    try {
      act(() =>
        app.agents.place(
          settled({ agentId: 'thr_mate', intent: 'fix web', agentType: 'teammate' }),
        ),
      )
      await setup.flush()

      const frame = setup.captureCharFrame()
      expect(frame).toContain('fix web')
      expect(frame).not.toContain('1 done')
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})
