import { describe, expect, test } from 'bun:test'

import { EAgentStatus } from '@dltech/atlas-core'

import { NOTHING_TALLIED } from '../../store/sidebar-spend'
import { sidebarModelOf, spendOf, teammatesOf } from '../sidebar-model'
import { viewFixture } from './view-fixture'
import { sessionRowFixture } from './view-fixture'
import { panesOfView } from '../session-view'

const EMPTY_CREW = { rows: [], standings: new Map() }

describe('spendOf', () => {
  test('a null tally is nothing tallied, never a free conversation', () => {
    expect(spendOf(null)).toBe(NOTHING_TALLIED)
    expect(spendOf(null).costUsd).toBeNull()
  })

  test('a tally keeps its tokens and its price', () => {
    const spend = spendOf({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
      uncachedInputTokens: 8,
      costUsd: 0.25,
    })

    expect(spend.totals.inputTokens).toBe(10)
    expect(spend.totals.outputTokens).toBe(5)
    expect(spend.costUsd).toBe(0.25)
  })
})

describe('teammatesOf', () => {
  test('keeps only the spawned rows, newest first, with their state as activity', () => {
    const teammates = teammatesOf({
      rows: [
        sessionRowFixture({
          sessionId: 'old',
          title: 'the older teammate',
          spawnedBy: 'session-one',
          updatedAt: '2026-11-20T00:00:00.000Z',
          status: { state: 'idle' as never },
        }),
        sessionRowFixture({ sessionId: 'main' }),
        sessionRowFixture({
          sessionId: 'new',
          title: 'the newer teammate',
          spawnedBy: 'session-one',
          updatedAt: '2026-11-21T00:00:00.000Z',
          status: { state: 'working' as never },
        }),
      ],
      now: Date.now(),
    })

    expect(teammates.map((row) => row.id)).toEqual(['new', 'old'])
    expect(teammates[0]?.activity).toBe('working')
  })

  test('an archived row reads archived', () => {
    const teammates = teammatesOf({
      rows: [
        sessionRowFixture({
          sessionId: 'done',
          spawnedBy: 'session-one',
          archivedAt: '2026-11-21T00:00:00.000Z',
        }),
      ],
      now: Date.now(),
    })

    expect(teammates[0]?.activity).toBe('archived')
  })
})

describe('sidebarModelOf', () => {
  const build = (args: { plan: boolean; fold: boolean }) =>
    sidebarModelOf({
      events: [],
      name: 'the open session',
      panes: panesOfView(
        viewFixture(
          args.plan
            ? {
                pluginViews: {
                  plan: {
                    tasks: [{ ordinal: 1, text: 'from the view', status: 'pending' }],
                    pending: {},
                  },
                },
              }
            : {},
        ),
      ),
      crew: EMPTY_CREW,
      teammates: [],
      sections: [],
      now: Date.now(),
    })

  test('the plan view supplies the tasks when the log has no plan', () => {
    const model = build({ plan: true, fold: false })

    expect(model.todo?.map((task) => task.label)).toEqual(['from the view'])
  })

  test('with no plan anywhere the sidebar draws no todo', () => {
    const model = build({ plan: false, fold: false })

    expect(model.todo).toBeUndefined()
    expect(model.title).toBe('the open session')
  })
})

describe('sidebarModelOf crew', () => {
  test('a teammate row becomes a section row with its state as activity', () => {
    const model = sidebarModelOf({
      events: [],
      name: null,
      panes: panesOfView(undefined),
      crew: EMPTY_CREW,
      teammates: [
        sessionRowFixture({
          sessionId: 'mate-1',
          title: 'the mate',
          spawnedBy: 'session-one',
          status: { state: 'idle' as never },
        }),
      ],
      sections: [],
      now: Date.now(),
    })

    expect(model.teammates?.[0]).toEqual({ id: 'mate-1', name: 'the mate', activity: 'idle' })
  })

  test('a crew row reaches the model through withCrew', () => {
    const model = sidebarModelOf({
      events: [],
      name: null,
      panes: panesOfView(undefined),
      crew: {
        rows: [
          {
            id: 'agent-1',
            name: 'read the tree',
            state: 'running',
            model: null,
            selected: false,
            failureReason: null,
            status: EAgentStatus.Running,
            startedAt: '2026-11-20T00:00:00.000Z',
            endedAt: null,
          },
        ],
        standings: new Map(),
      },
      teammates: [],
      sections: [],
      now: Date.now(),
    })

    expect(model.subagents?.map((row) => row.id)).toEqual(['agent-1'])
  })
})
