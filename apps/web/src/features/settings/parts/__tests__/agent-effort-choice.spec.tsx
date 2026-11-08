import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'

import { EEffortLevel } from '@dltech/atlas-wire/web'

import { AgentEffortChoice } from '../agent-effort-choice'

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
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
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const mounted = root
  await act(async () => mounted.render(node))
  return container
}

const itemLabels = (element: HTMLElement): string[] =>
  [...element.querySelectorAll('[data-slot="toggle-group-item"]')].map(
    (item) => item.textContent ?? '',
  )

async function press(element: HTMLElement, label: string): Promise<void> {
  const item = [...element.querySelectorAll('[data-slot="toggle-group-item"]')].find(
    (candidate) => candidate.textContent === label,
  )
  if (!(item instanceof HTMLElement)) throw new Error(`no item ${label}`)
  await act(async () => {
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

describe('AgentEffortChoice', () => {
  it('lists Inherit followed by the whole ladder', async () => {
    const element = await render(
      <AgentEffortChoice value={undefined} onChange={() => {}} label="x" />,
    )
    expect(itemLabels(element)).toEqual([
      'Inherit',
      'Off',
      'Minimal',
      'Low',
      'Medium',
      'High',
      'XHigh',
      'Max',
    ])
  })

  it('filters rungs to the supported set', async () => {
    const element = await render(
      <AgentEffortChoice
        value={undefined}
        onChange={() => {}}
        label="x"
        supportedEfforts={[EEffortLevel.Low, EEffortLevel.High]}
      />,
    )
    expect(itemLabels(element)).toEqual(['Inherit', 'Low', 'High'])
  })

  it('marks Inherit pressed when there is no value', async () => {
    const element = await render(
      <AgentEffortChoice value={undefined} onChange={() => {}} label="x" />,
    )
    const pressed = [...element.querySelectorAll('[data-pressed]')].map((item) => item.textContent)
    expect(pressed).toEqual(['Inherit'])
  })

  it('reports a rung, then undefined when Inherit is chosen', async () => {
    const changes: (EEffortLevel | undefined)[] = []
    const element = await render(
      <AgentEffortChoice
        value={EEffortLevel.High}
        onChange={(next) => changes.push(next)}
        label="x"
      />,
    )
    await press(element, 'Low')
    await press(element, 'Inherit')
    expect(changes).toEqual([EEffortLevel.Low, undefined])
  })
})
