import { EAgentStatus, toRunId, toThreadId } from '@dltech/atlas-core'
import {
  EChecksState,
  EForge,
  EPullRequestLookup,
  EPullRequestState,
  type AgentSnapshot,
  type PullRequest,
  type RepositoryCheckout,
} from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React, { act } from 'react'

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
  deliveredAt?: string | undefined
}): AgentSnapshot => ({
  ...fakeAgentSnapshot({
    agentId: args.agentId,
    intent: args.intent,
    status: args.status ?? EAgentStatus.Finished,
    toolCalls: 3,
    ...(args.agentType === undefined ? {} : { agentType: args.agentType }),
  }),
  endedAt: LONG_AGO,
  deliveredAt: args.deliveredAt,
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

const deliveredSubagents = (count: number): readonly AgentSnapshot[] =>
  Array.from({ length: count }, (_, at) =>
    settled({ agentId: `thr_done_${at}`, intent: `audit ${at}`, deliveredAt: LONG_AGO }),
  )

const pullRequestOf = (state: EPullRequestState): PullRequest => ({
  number: 88,
  title: 'a change',
  url: 'https://github.com/dennisofficial/atlas/pull/88',
  state,
  checks: EChecksState.None,
  tally: { running: 0, passed: 0, failed: 0 },
  mergeable: null,
  comments: [],
  reviews: [],
})

describe('a settled sub-agent collapsing in the sidebar', () => {
  it('holds a finished child whose result the parent has not read', async () => {
    const app = appWith()
    const setup = await opened(app)

    try {
      act(() => app.agents.place(settled({ agentId: 'thr_undelivered', intent: 'pending audit' })))
      await setup.flush()

      expect(setup.captureCharFrame()).toContain('pending audit')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('keeps a lone delivered child on the panel rather than hiding it', async () => {
    const app = appWith()
    const setup = await opened(app)

    try {
      act(() => app.agents.place(settled({ agentId: 'thr_read', intent: 'consumed audit', deliveredAt: LONG_AGO })))
      await setup.flush()

      const frame = setup.captureCharFrame()
      expect(frame).toContain('consumed audit')
      expect(frame).toContain('SUB-AGENTS  0/1')
      expect(frame).not.toContain('settled ▸')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('folds the older settled children behind a settled line, counting the full tier', async () => {
    const app = appWith()
    const setup = await opened(app)

    try {
      act(() => {
        for (const child of deliveredSubagents(5)) app.agents.place(child)
      })
      await setup.flush()

      const frame = setup.captureCharFrame()
      expect(frame).toContain('SUB-AGENTS  0/5')
      expect(frame).toContain('3 settled ▸')
      expect(frame).not.toContain('audit 0')
      expect(frame).toContain('audit 4')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('still walks to a child that has collapsed, because only the row folded', async () => {
    const app = appWith()
    await app.log.append({
      threadId: toThreadId('thr_done_0'),
      runId: toRunId('run-child'),
      drafts: [{ type: 'assistant-said', parts: [{ type: 'text', text: CHILD_SAID }] }],
    })
    const setup = await opened(app)

    try {
      act(() => {
        for (const child of deliveredSubagents(5)) app.agents.place(child)
      })
      await setup.flush()
      expect(setup.captureCharFrame()).not.toContain('audit 0')

      setup.mockInput.pressKey('g', { ctrl: true })
      await setup.flush()
      await settle(250)
      await setup.flush()

      expect(setup.captureCharFrame()).toContain(CHILD_SAID)
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('folds a teammate tier and a sub-agent tier separately', async () => {
    const app = appWith()
    const setup = await opened(app)

    try {
      act(() => {
        for (let at = 0; at < 4; at += 1) {
          app.agents.place(
            settled({ agentId: `thr_mate_${at}`, intent: `fix ${at}`, agentType: 'teammate', deliveredAt: LONG_AGO }),
          )
        }
        for (const child of deliveredSubagents(5)) app.agents.place(child)
      })
      await setup.flush()

      const frame = setup.captureCharFrame()
      expect(frame).toContain('TEAMMATES  0/4')
      expect(frame).toContain('SUB-AGENTS  0/5')
      expect(frame).toContain('2 settled ▸')
      expect(frame).toContain('3 settled ▸')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('never folds a failure the operator has not opened', async () => {
    const app = appWith()
    const setup = await opened(app)

    try {
      act(() => {
        app.agents.place(
          settled({ agentId: 'thr_failed', intent: 'broken audit', status: EAgentStatus.Failed, deliveredAt: LONG_AGO }),
        )
        for (const child of deliveredSubagents(5)) app.agents.place(child)
      })
      await setup.flush()

      const frame = setup.captureCharFrame()
      expect(frame).toContain('broken audit')
      expect(frame).toContain('3 settled ▸')
      expect(frame).not.toContain('one failed')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('keeps a running child beside its folded settled siblings', async () => {
    const app = appWith()
    const setup = await opened(app)

    try {
      act(() => {
        app.agents.place(fakeAgentSnapshot({ agentId: 'thr_live', intent: 'live audit' }))
        for (const child of deliveredSubagents(5)) app.agents.place(child)
      })
      await setup.flush()

      const frame = setup.captureCharFrame()
      expect(frame).toContain('live audit')
      expect(frame).toContain('SUB-AGENTS  1/6')
      expect(frame).toContain('3 settled ▸')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('holds a finished teammate with an open pull request out of the fold until it merges', async () => {
    const app = appWith()
    let state = EPullRequestState.Open
    let version = 0
    const listeners = new Set<() => void>()
    const checkout: RepositoryCheckout = {
      directory: '/work/mate',
      branch: 'mate-work',
      forge: EForge.GitHub,
      remote: { host: 'github.com', owner: 'dennisofficial', repo: 'atlas' },
    }
    app.crewPullRequests = {
      service: {
        snapshot: () => ({ lookup: EPullRequestLookup.Found, pullRequest: pullRequestOf(state) }),
        version: () => version,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      },
      checkoutFor: ({ threadId }) => (threadId === toThreadId('thr_mate_0') ? checkout : null),
    }
    const setup = await opened(app)

    try {
      act(() => {
        for (let at = 0; at < 5; at += 1) {
          app.agents.place(
            settled({ agentId: `thr_mate_${at}`, intent: `fix ${at}`, agentType: 'teammate', deliveredAt: LONG_AGO }),
          )
        }
      })
      await setup.flush()

      const held = setup.captureCharFrame()
      expect(held).toContain('fix 0')
      expect(held).toContain('2 settled ▸')
      expect(held).not.toContain('fix 1')

      act(() => {
        state = EPullRequestState.Merged
        version += 1
        for (const listener of listeners) listener()
      })
      await setup.flush()

      const released = setup.captureCharFrame()
      expect(released).not.toContain('fix 0')
      expect(released).toContain('3 settled ▸')
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})
