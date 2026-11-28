import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { EHeaderState } from '@/features/threads/data/header-model'

import { SessionHeader } from '../session-header'

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

const roots = new Set<Root>()

afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount())
  roots.clear()
})

const headerOf = (args: {
  paneCollapsed?: boolean
  onTogglePane?: () => void
  onOpenPane: () => void
  detailsOpen?: boolean
  onToggleDetails?: () => void
}) => (
  <SidebarProvider>
    <SessionHeader
      sessionId="s1"
      state={EHeaderState.Idle}
      title="Fix login"
      naming={false}
      branch={undefined}
      entries={[]}
      subscriptions={[]}
      shells={{ running: 0, awaitingInput: false, labels: [], rows: [] }}
      shellTails={{}}
      crew={{ running: 0, total: 0 }}
      crewRows={[]}
      previews={[]}
      paneCollapsed={args.paneCollapsed}
      onTogglePane={args.onTogglePane}
      onOpenPane={args.onOpenPane}
      detailsOpen={args.detailsOpen}
      onToggleDetails={args.onToggleDetails}
      onOpenPreview={() => undefined}
    />
  </SidebarProvider>
)

async function mount(args: {
  paneCollapsed?: boolean
  onTogglePane?: () => void
  onOpenPane: () => void
  detailsOpen?: boolean
  onToggleDetails?: () => void
}) {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.add(root)
  await act(async () => root.render(headerOf(args)))
  const buttonOf = (label: string) => {
    const button = container.querySelector(`[aria-label="${label}"]`)
    if (button === null) throw new Error(`no ${label} button`)
    return button
  }
  return { buttonOf }
}

describe('SessionHeader pane buttons', () => {
  it('opens the pane on a narrow screen', async () => {
    const calls: string[] = []
    const { buttonOf } = await mount({ onOpenPane: () => calls.push('open') })
    await act(async () => buttonOf('Open panel').click())
    expect(calls).toEqual(['open'])
  })

  it('opens and closes the tools panel with one button', async () => {
    const calls: string[] = []
    const { buttonOf } = await mount({
      paneCollapsed: true,
      onOpenPane: () => undefined,
      onTogglePane: () => calls.push('toggle'),
    })
    const toggle = buttonOf('Open tools')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await act(async () => toggle.click())
    expect(calls).toEqual(['toggle'])
  })
})

describe('SessionHeader details card button', () => {
  it('toggles the details card and reports whether it is open', async () => {
    const calls: string[] = []
    const { buttonOf } = await mount({
      detailsOpen: true,
      onOpenPane: () => calls.push('open'),
      onToggleDetails: () => calls.push('details'),
    })
    const details = buttonOf('Session details')
    expect(details.getAttribute('aria-expanded')).toBe('true')
    await act(async () => details.click())
    expect(calls).toEqual(['details'])
  })
})
