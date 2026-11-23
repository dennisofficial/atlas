import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'

import { ETranscriptKind, type RotationItem, type TranscriptRow } from '../data/transcript-items'
import { ETurnKind, turnsOf } from '../data/transcript-turns'
import { RotationDivider } from '../../sessions/rotation-divider'

const HANDOFF = 'Goal: fix the flaky test. Next: read packages/core/src/record/log.ts.'

const itemOf = (extra: Partial<RotationItem> = {}): RotationItem => ({
  kind: ETranscriptKind.Rotation,
  id: 'e1',
  text: 'rotated automatically at 86% of the window',
  handoff: HANDOFF,
  at: '2026-11-23T11:04:00.000Z',
  ...extra,
})

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(async () => {
  const mounted = root
  if (mounted !== null) await act(async () => mounted.unmount())
  root = null
  container?.remove()
  container = null
})

async function render(node: ReactNode): Promise<HTMLDivElement> {
  const { createRoot } = await import('react-dom/client')
  if (container === null) {
    container = document.createElement('div')
    document.body.append(container)
  }
  if (root === null) root = createRoot(container)
  const mounted = root
  await act(async () => mounted.render(node))
  return container
}

async function click(target: Element): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

describe('the rotation divider', () => {
  it('draws the label, the time and a closed brief', async () => {
    const element = await render(<RotationDivider item={itemOf()} timestamp="11:04 AM" />)

    expect(element.textContent).toContain('rotated automatically at 86% of the window')
    expect(element.textContent).toContain('11:04 AM')
    expect(element.textContent).toContain('Show brief')
    expect(element.textContent).not.toContain(HANDOFF)
  })

  it('opens the brief when the button is pressed', async () => {
    const element = await render(<RotationDivider item={itemOf()} timestamp="11:04 AM" />)
    const trigger = element.querySelector('button')
    if (trigger === null) throw new Error('no brief button')

    await click(trigger)

    expect(element.textContent).toContain(HANDOFF)
    expect(element.textContent).toContain('Hide brief')
  })

  it('breaks out of a running agent turn instead of joining it', () => {
    const rows: TranscriptRow[] = [
      { kind: ETranscriptKind.Agent, id: 'a1', text: 'before', streaming: false },
      itemOf(),
      { kind: ETranscriptKind.Agent, id: 'a2', text: 'after', streaming: false },
    ]

    const turns = turnsOf({ items: rows, working: false })

    expect(turns.map((turn) => turn.kind)).toEqual([
      ETurnKind.Agent,
      ETurnKind.Rotation,
      ETurnKind.Agent,
    ])
  })
})
