import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import type { ShellRoster } from '@dltech/atlas-plugin-shells/client'

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

const { ShellTails } = await import('../shell-tails')

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

const shells: ShellRoster = {
  running: 1,
  awaitingInput: false,
  labels: ['dev server'],
  rows: [{ shellId: 'shell-1', name: 'dev server' }],
}

const mount = async (sessionId: string | undefined) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.add(root)
  await act(async () =>
    root.render(<ShellTails shells={shells} tails={{}} sessionId={sessionId} />),
  )
  return container
}

describe('the shell tails actions', () => {
  it('kills a running shell with the shell-kill command', async () => {
    const container = await mount('s1')
    const stop = container.querySelector('[data-shell-kill="shell-1"]')
    if (stop === null) throw new Error('no stop button')
    await act(async () => (stop as HTMLElement).click())
    expect(calls).toEqual([{ sessionId: 's1', name: 'shell-kill', args: { shellId: 'shell-1' } }])
  })

  it('draws no stop button when the surface has no session to command', async () => {
    const container = await mount(undefined)
    expect(container.querySelector('[data-shell-kill]')).toBeNull()
  })
})
