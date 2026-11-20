import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'

import type { TerminalRow } from '@dltech/atlas-protocol'
import { ETerminalConnection } from '@dltech/atlas-ui/ai/terminal-states'

import { paneValueFixture } from '../../panel/__tests__/fixture'
import { SessionPaneProvider, type SessionPaneValue } from '../../panel/pane-value'
import type { TerminalTransportOf } from '../terminal-api'
import { ETerminalOp, type TerminalProblem } from '../terminal-model'
import { forgetTerminalStore } from '../terminals-store'
import { TerminalTab } from '../terminal-tab'
import type { TerminalTransport } from '../terminal-transport'

const row = (overrides: Partial<TerminalRow> = {}): TerminalRow => ({
  terminalId: 't1',
  ordinal: 1,
  name: 'Terminal 1',
  state: 'open',
  exitCode: null,
  signal: null,
  endedReason: null,
  createdAt: 1,
  endedAt: null,
  ...overrides,
})

function fakeTransportOf(initial: TerminalRow[]) {
  const rows = [...initial]
  const calls = { open: 0, close: [] as string[], rename: [] as string[], reconnect: 0 }
  let raise: ((problem: TerminalProblem | undefined) => void) | undefined
  const transportOf: TerminalTransportOf = (args) => {
    raise = args.onProblem
    const transport: TerminalTransport = {
      list: async () => [...rows],
      open: async () => {
        calls.open += 1
        rows.push(row({ terminalId: 't9', ordinal: rows.length + 1, name: 'Terminal 9' }))
        return { state: 'open', terminalId: 't9', pid: 1 }
      },
      write: () => undefined,
      resize: () => undefined,
      close: async (terminalId) => {
        calls.close.push(terminalId)
        const index = rows.findIndex((entry) => entry.terminalId === terminalId)
        if (index >= 0) rows.splice(index, 1)
      },
      rename: async (terminalId, name) => {
        calls.rename.push(name)
        const entry = rows.find((candidate) => candidate.terminalId === terminalId)
        if (entry) entry.name = name
      },
      read: async () => ({ offset: 0, data: '', totalBytes: 0, exited: null }),
      reconnect: () => {
        calls.reconnect += 1
        args.onLink(ETerminalConnection.Connected)
      },
      dispose: () => undefined,
    }
    return transport
  }
  return {
    transportOf,
    calls,
    rows,
    raise: (problem: TerminalProblem | undefined) => raise?.(problem),
  }
}

const valueOf = (live: boolean): SessionPaneValue =>
  paneValueFixture({
    status: {
      state: 'idle',
      lease: { epoch: 1, holderHostId: live ? 7 : null, live },
      sandbox: { status: live ? 'running' : 'sleeping', at: '2026-01-01T00:00:00.000Z' },
    },
  } as never)

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

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
  forgetTerminalStore('ses-1')
})

async function mount(args: { live: boolean; transportOf: TerminalTransportOf }) {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.add(root)
  const render = (live: boolean) =>
    root.render(
      <SessionPaneProvider value={valueOf(live)}>
        <TerminalTab transportOf={args.transportOf} />
      </SessionPaneProvider>,
    )
  await act(async () => render(args.live))
  await flush()
  return { container, rerender: render }
}

const click = async (element: Element | null) => {
  if (element === null) throw new Error('missing element')
  await act(async () => {
    ;(element as HTMLElement).click()
  })
  await flush()
}

describe('TerminalTab', () => {
  it('opens nothing on tab open', async () => {
    const fake = fakeTransportOf([])
    const { container } = await mount({ live: true, transportOf: fake.transportOf })
    expect(container.textContent).toContain('No terminals')
    expect(container.querySelector('[data-terminal-screen]')).toBeNull()
    expect(fake.calls.open).toBe(0)
  })

  it('renders an empty terminal tab for a session with no rows', () => {
    const fake = fakeTransportOf([])
    const html = renderToStaticMarkup(
      <SessionPaneProvider value={valueOf(true)}>
        <TerminalTab transportOf={fake.transportOf} />
      </SessionPaneProvider>,
    )
    expect(html).toContain('No terminals')
    expect(html).not.toContain('data-terminal-screen')
  })

  it('shows a failed write in the terminal, then clears it once the stream is back', async () => {
    const fake = fakeTransportOf([row()])
    const { container } = await mount({ live: true, transportOf: fake.transportOf })
    await act(async () => fake.raise({ op: ETerminalOp.Write, message: 'pod is asleep' }))
    expect(container.textContent).toContain('pod is asleep')
    await act(async () => fake.raise(undefined))
    expect(container.textContent).not.toContain('pod is asleep')
  })

  it('creates a terminal when the user presses plus', async () => {
    const fake = fakeTransportOf([])
    const { container } = await mount({ live: true, transportOf: fake.transportOf })
    await click(
      Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('New terminal'),
      ) ?? null,
    )
    expect(fake.calls.open).toBe(1)
    expect(container.textContent).toContain('Terminal 9')
  })

  it('closes a terminal and drops its tab', async () => {
    const fake = fakeTransportOf([row({ state: 'ended', endedReason: 'exited', exitCode: 0 })])
    const { container } = await mount({ live: true, transportOf: fake.transportOf })
    expect(container.textContent).toContain('Terminal 1')
    await click(container.querySelector('button[aria-label="Close Terminal 1"]'))
    expect(fake.calls.close).toEqual(['t1'])
    expect(container.textContent).not.toContain('Terminal 1')
    expect(container.textContent).toContain('No terminals')
  })

  it('shows the disconnected panel, then loads rows after Wake pod', async () => {
    const fake = fakeTransportOf([row()])
    const { container, rerender } = await mount({ live: false, transportOf: fake.transportOf })
    expect(container.textContent).toContain('Disconnected')
    expect(container.textContent).toContain('Wake pod')
    expect(container.querySelector('[data-terminal-screen]')).toBeNull()

    const originalFetch = globalThis.fetch
    globalThis.fetch = (() => new Promise(() => undefined)) as typeof fetch
    try {
      await click(
        Array.from(container.querySelectorAll('button')).find((button) =>
          button.textContent?.includes('Wake pod'),
        ) ?? null,
      )
      expect(container.textContent).toContain('Waking pod…')
    } finally {
      globalThis.fetch = originalFetch
    }

    await act(async () => rerender(true))
    await flush()
    expect(fake.calls.reconnect).toBe(1)
    expect(container.textContent).toContain('Terminal 1')
  })

  it('renames a terminal from its tab', async () => {
    const fake = fakeTransportOf([row({ state: 'ended', endedReason: 'exited', exitCode: 0 })])
    const { container } = await mount({ live: true, transportOf: fake.transportOf })
    const label = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Terminal 1'),
    )
    if (label === undefined) throw new Error('missing tab label')
    await act(async () => {
      label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    const input = container.querySelector('input[aria-label="Rename Terminal 1"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('missing rename input')
    await act(async () => {
      input.value = 'dev server'
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await flush()
    expect(fake.calls.rename).toEqual(['dev server'])
    expect(container.textContent).toContain('dev server')
  })
})
