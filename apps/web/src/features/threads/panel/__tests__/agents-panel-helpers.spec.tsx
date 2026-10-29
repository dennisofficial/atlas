import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'
import { EPodState } from '@dltech/atlas-wire/web'

import type { AgentView } from '../../data/agents-model'
import { agentsOfflineCopyOf } from '../agents/agents-offline-copy'
import { panelAgentOf } from '../agents/agents-panel-model'
import { jumpToSpawn, spawnDomId, type SpawnTarget } from '../agents/agents-spawn-jump'

const view = (over: Partial<AgentView> = {}): AgentView => ({
  id: 'a',
  agentType: 'explore',
  intent: 'Find importers',
  display: EAgentDisplay.Running,
  live: true,
  startedAt: 0,
  endedAt: undefined,
  model: undefined,
  context: undefined,
  latestCall: 'Using read',
  report: undefined,
  errorText: undefined,
  toolCalls: 0,
  teammate: false,
  ...over,
})

describe('panelAgentOf', () => {
  it('ticks elapsed against now while live and stops at the end when finished', () => {
    expect(panelAgentOf({ view: view(), now: 65_000 }).elapsed).toBe('1m 5s')
    const done = view({ live: false, display: EAgentDisplay.Done, endedAt: 12_000 })
    expect(panelAgentOf({ view: done, now: 999_000 }).elapsed).toBe('12s')
  })

  it('uses the intent as the brief', () => {
    expect(panelAgentOf({ view: view(), now: 0 }).brief).toBe('Find importers')
  })

  it('renders the report as markdown only when there is one', () => {
    expect(panelAgentOf({ view: view(), now: 0 }).report).toBeUndefined()
    const withReport = view({ report: 'Found 3', display: EAgentDisplay.Done, live: false })
    expect(
      renderToStaticMarkup(<>{panelAgentOf({ view: withReport, now: 0 }).report}</>),
    ).toContain('Found 3')
  })
})

describe('agentsOfflineCopyOf', () => {
  it('has no offline copy for a running pod or an unknown pod', () => {
    expect(agentsOfflineCopyOf(null)).toBeNull()
    expect(agentsOfflineCopyOf({ state: EPodState.Running, steps: [] })).toBeNull()
  })

  it.each([EPodState.None, EPodState.Parked, EPodState.Booting, EPodState.Failed])(
    'explains %s',
    (state) => {
      expect(agentsOfflineCopyOf({ state, steps: [] })?.title.length).toBeGreaterThan(0)
    },
  )
})

describe('jumpToSpawn', () => {
  const targetOf = () => {
    const scrollIntoView = mock(() => undefined)
    const animate = mock(() => undefined)
    return {
      target: { scrollIntoView, animate } as unknown as SpawnTarget,
      scrollIntoView,
      animate,
    }
  }

  it('scrolls to and flashes the transcript spawn card', () => {
    const { target, scrollIntoView, animate } = targetOf()
    const ids: string[] = []
    const found = jumpToSpawn({
      agentId: 'a',
      lookup: (id) => {
        ids.push(id)
        return target
      },
    })
    expect(found).toBe(true)
    expect(ids).toEqual([spawnDomId('a')])
    expect(spawnDomId('a')).toBe('agent-spawn-a')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(animate).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the card is not in the transcript', () => {
    expect(jumpToSpawn({ agentId: 'a', lookup: () => null })).toBe(false)
  })
})
