import { describe, expect, test } from 'bun:test'

import { EAgentStatus, EPlanStatus, EServiceStatus, EShellStatus } from '@dltech/atlas-core'
import { ESidebarTaskState } from '../../store/sidebar-model'
import { contextReadingOf, panesOfView, planTasksOf } from '../session-view'
import { viewFixture as viewOf } from './view-fixture'

const crewRow = {
  agentId: 'agent-1',
  agentType: 'general-purpose',
  intent: 'read the tree',
  status: EAgentStatus.Running,
  turns: 1,
  toolCalls: 2,
  startedAt: '2026-11-20T00:00:00.000Z',
}

const shellRow = (args: { shellId: string; status: EShellStatus; changedAt: string }) => ({
  shellId: args.shellId,
  name: args.shellId,
  command: 'bun test',
  status: args.status,
  characters: 0,
  awaitingInput: false,
  changedAt: args.changedAt,
})

const serviceRow = (args: { serviceId: string; status: EServiceStatus; changedAt: string }) => ({
  serviceId: args.serviceId,
  command: 'bun dev',
  status: args.status,
  ready: false,
  changedAt: args.changedAt,
})

describe('panesOfView', () => {
  test('crew rows use the shared active-first ordering', () => {
    const panes = panesOfView(
      viewOf({
        pluginViews: {
          crew: [
            { ...crewRow, agentId: 'ended', status: EAgentStatus.Finished },
            { ...crewRow, agentId: 'paused', status: EAgentStatus.Paused },
            { ...crewRow, agentId: 'running', status: EAgentStatus.Running },
          ],
        },
      }),
    )
    expect(panes.crew.map((row) => row.agentId)).toEqual(['running', 'paused', 'ended'])
  })

  test('an absent view yields every list empty', () => {
    const panes = panesOfView(undefined)

    expect(panes.crew).toEqual([])
    expect(panes.shells).toEqual([])
    expect(panes.services).toEqual([])
    expect(panes.previews).toEqual([])
    expect(panes.plan).toEqual([])
    expect(panes.spend).toBeNull()
    expect(panes.context).toBeNull()
    expect(panes.branch).toBeNull()
    expect(panes.repo).toBeNull()
  })

  test('reads the panes through the plugin views', () => {
    const panes = panesOfView(
      viewOf({
        pluginViews: {
          crew: [crewRow],
          shells: [shellRow({ shellId: 'sh-1', status: EShellStatus.Running, changedAt: '2' })],
          services: [
            serviceRow({ serviceId: 'svc-1', status: EServiceStatus.Running, changedAt: '2' }),
          ],
        },
        checkouts: { repos: [], primary: { repo: 'dennisofficial/atlas', branch: 'main' } },
        spend: {
          rows: [],
          tally: {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            uncachedInputTokens: 10,
            costUsd: 0.5,
          },
        },
      }),
    )

    expect(panes.crew.map((row) => row.agentId)).toEqual(['agent-1'])
    expect(panes.shells.map((row) => row.shellId)).toEqual(['sh-1'])
    expect(panes.services.map((row) => row.serviceId)).toEqual(['svc-1'])
    expect(panes.branch).toBe('main')
    expect(panes.repo).toBe('dennisofficial/atlas')
    expect(panes.spend?.costUsd).toBe(0.5)
  })

  test('running rows sort ahead of settled ones, newest first inside a group', () => {
    const panes = panesOfView(
      viewOf({
        pluginViews: {
          shells: [
            shellRow({ shellId: 'settled-new', status: EShellStatus.Exited, changedAt: '9' }),
            shellRow({ shellId: 'running-old', status: EShellStatus.Running, changedAt: '1' }),
            shellRow({ shellId: 'running-new', status: EShellStatus.Running, changedAt: '5' }),
          ],
        },
      }),
    )

    expect(panes.shells.map((row) => row.shellId)).toEqual([
      'running-new',
      'running-old',
      'settled-new',
    ])
  })

  test('a context window of zero yields no reading', () => {
    const view = viewOf({
      context: { used: 10, window: 0, measuredThroughSeq: 1, breakdown: [] },
    })

    expect(contextReadingOf(view)).toBeNull()
  })
})

describe('planTasksOf', () => {
  test('maps the plan states onto the sidebar states', () => {
    const tasks = planTasksOf([
      { ordinal: 1, text: 'read', status: EPlanStatus.Completed },
      { ordinal: 2, text: 'write', status: EPlanStatus.InProgress, activeForm: 'writing' },
      { ordinal: 3, text: 'test', status: EPlanStatus.Pending },
    ])

    expect(tasks.map((task) => task.state)).toEqual([
      ESidebarTaskState.Done,
      ESidebarTaskState.Running,
      ESidebarTaskState.Pending,
    ])
    expect(tasks.map((task) => task.id)).toEqual(['1', '2', '3'])
    expect(tasks[1]?.activeForm).toBe('writing')
  })
})
