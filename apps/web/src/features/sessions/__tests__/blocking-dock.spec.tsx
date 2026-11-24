import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act, type ReactElement } from 'react'
import type { Root } from 'react-dom/client'

import type { BlockingCommand } from '@dltech/atlas-client/stream'
import { ECommandState, type SessionCommandRow } from '@dltech/atlas-protocol'

import { BlockingDock } from '../blocking/blocking-dock'

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(() => {
  document.body.innerHTML = ''
})

const SUMMARISE: BlockingCommand = {
  inboxId: 105,
  name: 'summarise',
  startedAt: new Date(Date.now() - 42_000).toISOString(),
  copy: { label: 'Summarising history', queued: 'Waits for the summary' },
}

const RUNNING_ROW: SessionCommandRow = {
  inboxId: 105,
  name: 'summarise',
  postedAt: SUMMARISE.startedAt,
  state: ECommandState.Running,
}

const QUEUED_ROW: SessionCommandRow = {
  inboxId: 107,
  name: 'rewind',
  postedAt: SUMMARISE.startedAt,
  state: ECommandState.Queued,
}

const dockWith = (blocking: BlockingCommand | undefined): ReactElement => (
  <BlockingDock blocking={blocking} commands={[RUNNING_ROW, QUEUED_ROW]}>
    <textarea aria-label="composer" />
  </BlockingDock>
)

const mount = async (element: ReactElement): Promise<Root> => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(element))
  return root
}

describe('BlockingDock', () => {
  it('shows the strip with its label and elapsed clock instead of the running row', async () => {
    const root = await mount(dockWith(SUMMARISE))
    const strip = document.querySelector('[aria-label^="Summarising history"]')
    expect(strip?.textContent).toContain('Messages you send now wait for it')
    expect(strip?.textContent).toMatch(/0:4\d/)
    expect(document.body.textContent).not.toContain('Summarising…')
    expect(document.body.textContent).toContain('Rewind after this turn')
    expect(document.querySelector('[data-blocking-join]')).not.toBeNull()
    await act(async () => root.unmount())
  })

  it('keeps the composer mounted when the command starts and ends', async () => {
    const root = await mount(dockWith(undefined))
    const before = document.querySelector('textarea')
    await act(async () => root.render(dockWith(SUMMARISE)))
    expect(document.querySelector('textarea')).toBe(before)
    await act(async () => root.render(dockWith(undefined)))
    expect(document.querySelector('textarea')).toBe(before)
    expect(document.querySelector('[data-blocking-join]')).toBeNull()
    await act(async () => root.unmount())
  })
})
