import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import type { CrewRow } from '@dltech/atlas-plugin-crew/client'
import { EAgentStatus } from '@dltech/atlas-core'

import * as realSessionsApi from '../data/sessions-api'

const calls: unknown[] = []

mock.module('../data/sessions-api', () => ({
  ...realSessionsApi,
  sessionsApi: {
    ...realSessionsApi.sessionsApi,
    command: async (input: unknown) => {
      calls.push(input)
      return {}
    },
  },
}))

const { CrewPanel } = await import('../crew-panel')

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

const roots = new Set<Root>()

afterEach(async () => {
  calls.length = 0
  for (const root of roots) await act(async () => root.unmount())
  roots.clear()
})

const rowOf = (patch: Partial<CrewRow>): CrewRow => ({
  agentId: 'a1',
  agentType: 'general-purpose',
  intent: 'trace the port',
  status: EAgentStatus.Running,
  turns: 1,
  toolCalls: 2,
  startedAt: '2026-11-09T10:00:00.000Z',
  ...patch,
})

const mount = async (rows: readonly CrewRow[]) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.add(root)
  await act(async () =>
    root.render(<CrewPanel rows={rows} sessionId="s1" onOpenAgent={() => undefined} />),
  )
  return container
}

const buttonOf = (container: HTMLElement, attribute: string) => {
  const button =
    container.querySelector(`[data-crew-${attribute}]`) ??
    document.querySelector(`[data-crew-${attribute}]`)
  if (button === null) throw new Error(`no ${attribute} button`)
  return button as HTMLElement
}

const type = async (input: HTMLInputElement, text: string) => {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setValue?.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('the crew panel actions', () => {
  it('stops a live sub-agent with the agent command', async () => {
    const container = await mount([rowOf({})])
    await act(async () => buttonOf(container, 'stop=a1').click())
    expect(calls).toEqual([
      { sessionId: 's1', name: 'agent', args: { action: 'stop', agentId: 'a1' } },
    ])
  })

  it('messages a live sub-agent with the agent command', async () => {
    const container = await mount([rowOf({})])
    await act(async () => buttonOf(container, 'message=a1').click())
    const input = document.querySelector('[data-crew-message-text]') as HTMLInputElement | null
    if (input === null) throw new Error('no message input')
    await type(input, 'take the parser')
    await act(async () => buttonOf(container, 'message-send').click())
    expect(calls).toEqual([
      {
        sessionId: 's1',
        name: 'agent',
        args: { action: 'say', agentId: 'a1', text: 'take the parser' },
      },
    ])
  })

  it('draws no action for a sub-agent that has ended', async () => {
    const container = await mount([
      rowOf({ status: EAgentStatus.Finished }),
      rowOf({ agentId: 'a2', status: EAgentStatus.Stopped }),
    ])
    expect(container.querySelector('[data-crew-actions]')).toBeNull()
  })

  it('draws no action when the surface has no session to command', async () => {
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    const root = createRoot(container)
    roots.add(root)
    await act(async () => root.render(<CrewPanel rows={[rowOf({})]} />))
    expect(container.querySelector('[data-crew-actions]')).toBeNull()
  })
})
