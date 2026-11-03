import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'

import { EEffortLevel } from '@dltech/atlas-wire/web'

import { EffortSlider } from '../agent-effort-slider'

const NARROW: readonly EEffortLevel[] = [
  EEffortLevel.Off,
  EEffortLevel.Low,
  EEffortLevel.High,
  EEffortLevel.Max,
]

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

const rangeOf = (element: HTMLElement) => {
  const range = element.querySelector('input[type="range"]')
  if (!(range instanceof HTMLInputElement)) throw new Error('no slider range input')
  return range
}

const thumbOf = (element: HTMLElement) => {
  const thumb = element.querySelector('[data-slot="slider-thumb"]')
  if (!(thumb instanceof HTMLElement)) throw new Error('no slider thumb')
  return thumb
}

const labelTexts = (element: HTMLElement): string[] =>
  [...element.querySelectorAll('.relative > span')].map((label) => {
    const short = label.firstElementChild?.textContent ?? ''
    return label.classList.contains('text-foreground') ? `*${short}` : short
  })

describe('EffortSlider', () => {
  it('renders the full ladder when no supported rungs are given', async () => {
    const element = await render(
      <EffortSlider value={EEffortLevel.Medium} onChange={() => {}} label="Main agent effort" />,
    )

    expect(rangeOf(element).max).toBe('6')
    expect(labelTexts(element)).toEqual(['Off', 'Min', 'Low', '*Med', 'High', 'XHigh', 'Max'])
  })

  it('renders the full ladder when the supported list is empty', async () => {
    const element = await render(
      <EffortSlider
        value={EEffortLevel.Medium}
        onChange={() => {}}
        label="Main agent effort"
        supportedEfforts={[]}
      />,
    )

    expect(rangeOf(element).max).toBe('6')
  })

  it('renders only the supported rungs', async () => {
    const element = await render(
      <EffortSlider
        value={EEffortLevel.Low}
        onChange={() => {}}
        label="Main agent effort"
        supportedEfforts={NARROW}
      />,
    )

    expect(rangeOf(element).max).toBe('3')
    expect(labelTexts(element)).toEqual(['Off', '*Low', 'High', 'Max'])
  })

  it('maps drag positions to the filtered rungs', async () => {
    let picked: EEffortLevel | undefined
    const element = await render(
      <EffortSlider
        value={EEffortLevel.Low}
        onChange={(next) => {
          picked = next
        }}
        label="Main agent effort"
        supportedEfforts={NARROW}
      />,
    )

    await act(async () => {
      rangeOf(element).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
      )
    })

    expect(picked).toBe(EEffortLevel.Max)
    expect(element.textContent).not.toContain('Min')
    expect(element.textContent).not.toContain('Med')
    expect(element.textContent).not.toContain('XHigh')
  })

  it('displays an unsupported stored value clamped to the nearest supported rung', async () => {
    const element = await render(
      <EffortSlider
        value={EEffortLevel.Medium}
        onChange={() => {}}
        label="Main agent effort"
        supportedEfforts={NARROW}
      />,
    )

    expect(rangeOf(element).getAttribute('aria-valuenow')).toBe('2')
    expect(labelTexts(element)).toEqual(['Off', 'Low', '*High', 'Max'])
  })

  it('clamps a stored value above every supported rung down to the top rung', async () => {
    const element = await render(
      <EffortSlider
        value={EEffortLevel.XHigh}
        onChange={() => {}}
        label="Main agent effort"
        supportedEfforts={[EEffortLevel.Off, EEffortLevel.Low]}
      />,
    )

    const range = rangeOf(element)
    expect(range.max).toBe('1')
    expect(range.getAttribute('aria-valuenow')).toBe('1')
    expect(labelTexts(element)).toEqual(['Off', '*Low'])
  })
})
