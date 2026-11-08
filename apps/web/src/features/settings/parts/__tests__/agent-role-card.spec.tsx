import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'

import { EEffort } from '@dltech/atlas-ui/ai/model-selector'
import { EEffortLevel } from '@dltech/atlas-wire/web'

import type { ModelPicker } from '@/features/threads/data/use-model-picker'

import {
  BUILT_IN_AGENT_META,
  EAgentRole,
  EBuiltInAgentType,
  ROLE_META,
  type RoleSetting,
} from '../../fixtures/settings-agent'

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
}))

const { RoleCard } = await import('../agent-role-card')

const MAIN_META = ROLE_META[EAgentRole.Main]

const MODELS = [
  {
    id: 'mock/full',
    label: 'Full Ladder',
    provider: 'Mock',
    efforts: Object.values(EEffort),
  },
  {
    id: 'mock/narrow',
    label: 'Narrow',
    provider: 'Mock',
    efforts: [EEffort.Off, EEffort.Low, EEffort.High, EEffort.Max],
  },
  { id: 'mock/none', label: 'No Effort', provider: 'Mock', efforts: [] },
]

const picker: ModelPicker = {
  ready: true,
  options: { models: MODELS, reconnectProviders: [] },
  personalId: '',
  personalEffort: '',
  pinned: [],
  onPinnedChange: () => {},
}

const setting = (next: Partial<RoleSetting>): RoleSetting => ({
  model: 'auto',
  effort: EEffortLevel.Medium,
  ...next,
})

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

async function pickModel(element: HTMLElement, label: string): Promise<void> {
  const trigger = element.querySelector('[aria-haspopup]')
  if (!(trigger instanceof HTMLElement)) throw new Error('no model selector trigger')
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  const item = [...document.querySelectorAll('[cmdk-item]')].find(
    (candidate) => candidate.textContent?.trim().startsWith(label) === true,
  )
  if (!(item instanceof HTMLElement)) throw new Error(`no item ${label}`)
  await act(async () => {
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

const sliderLabels = (element: HTMLElement): string[] =>
  [...element.querySelectorAll('.relative > span')].map((label) => label.textContent ?? '')

describe('RoleCard effort row', () => {
  it('shows the full ladder for the auto/follow model', async () => {
    const element = await render(
      <RoleCard
        meta={MAIN_META}
        setting={setting({ model: 'auto', effort: EEffortLevel.Medium })}
        picker={picker}
        onChange={() => {}}
      />,
    )

    const range = element.querySelector('input[type="range"]')
    expect(range?.getAttribute('max')).toBe('6')
    expect(sliderLabels(element)).toHaveLength(7)
  })

  it('offers only the rungs a concrete model supports', async () => {
    const element = await render(
      <RoleCard
        meta={MAIN_META}
        setting={setting({ model: 'mock/narrow', effort: EEffortLevel.Low })}
        picker={picker}
        onChange={() => {}}
      />,
    )

    const range = element.querySelector('input[type="range"]')
    expect(range?.getAttribute('max')).toBe('3')
    expect(sliderLabels(element)).toHaveLength(4)
  })

  it('hides the effort row for a model with no effort map', async () => {
    const element = await render(
      <RoleCard
        meta={MAIN_META}
        setting={setting({ model: 'mock/none', effort: EEffortLevel.Medium })}
        picker={picker}
        onChange={() => {}}
      />,
    )

    expect(element.querySelector('[data-slot="slider-thumb"]')).toBeNull()
    expect(sliderLabels(element)).toHaveLength(0)
  })

  it('clamps the draft effort when switching to a narrower model', async () => {
    const changes: RoleSetting[] = []
    const element = await render(
      <RoleCard
        meta={MAIN_META}
        setting={setting({ model: 'mock/full', effort: EEffortLevel.Medium })}
        picker={picker}
        onChange={(next) => changes.push(next)}
      />,
    )

    await pickModel(element, 'Narrow')

    expect(changes).toEqual([{ model: 'mock/narrow', effort: EEffortLevel.High }])
  })

  it('keeps the draft effort when the new model supports it', async () => {
    const changes: RoleSetting[] = []
    const element = await render(
      <RoleCard
        meta={MAIN_META}
        setting={setting({ model: 'mock/narrow', effort: EEffortLevel.High })}
        picker={picker}
        onChange={(next) => changes.push(next)}
      />,
    )

    await pickModel(element, 'Full Ladder')

    expect(changes).toEqual([{ model: 'mock/full', effort: EEffortLevel.High }])
  })

  it('leaves the draft effort untouched when the new model has no effort map', async () => {
    const changes: RoleSetting[] = []
    const element = await render(
      <RoleCard
        meta={MAIN_META}
        setting={setting({ model: 'mock/full', effort: EEffortLevel.Medium })}
        picker={picker}
        onChange={(next) => changes.push(next)}
      />,
    )

    await pickModel(element, 'No Effort')

    expect(changes).toEqual([{ model: 'mock/none', effort: EEffortLevel.Medium }])
  })
})

const BUILDER_META = BUILT_IN_AGENT_META[EBuiltInAgentType.Builder]

const choiceLabels = (element: HTMLElement): string[] =>
  [...element.querySelectorAll('[data-slot="toggle-group-item"]')].map(
    (item) => item.textContent ?? '',
  )

async function pressChoice(element: HTMLElement, label: string): Promise<void> {
  const item = [...element.querySelectorAll('[data-slot="toggle-group-item"]')].find(
    (candidate) => candidate.textContent === label,
  )
  if (!(item instanceof HTMLElement)) throw new Error(`no item ${label}`)
  await act(async () => {
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

describe('RoleCard inheriting effort', () => {
  it('shows an Inherit item and no slider', async () => {
    const element = await render(
      <RoleCard
        meta={BUILDER_META}
        setting={{ model: 'auto' }}
        picker={picker}
        onChange={() => {}}
      />,
    )
    expect(choiceLabels(element)[0]).toBe('Inherit')
    expect(element.querySelector('input[type="range"]')).toBeNull()
  })

  it('reports the chosen rung and then undefined for Inherit', async () => {
    const changes: RoleSetting[] = []
    const element = await render(
      <RoleCard
        meta={BUILDER_META}
        setting={{ model: 'auto', effort: EEffortLevel.Low }}
        picker={picker}
        onChange={(next) => changes.push(next)}
      />,
    )
    await pressChoice(element, 'High')
    await pressChoice(element, 'Inherit')
    expect(changes).toEqual([{ model: 'auto', effort: EEffortLevel.High }, { model: 'auto' }])
  })

  it('offers only the rungs a narrow model supports', async () => {
    const element = await render(
      <RoleCard
        meta={BUILDER_META}
        setting={{ model: 'mock/narrow' }}
        picker={picker}
        onChange={() => {}}
      />,
    )
    expect(choiceLabels(element)).toEqual(['Inherit', 'Off', 'Low', 'High', 'Max'])
  })

  it('hides the row for a model with no effort map', async () => {
    const element = await render(
      <RoleCard
        meta={BUILDER_META}
        setting={{ model: 'mock/none' }}
        picker={picker}
        onChange={() => {}}
      />,
    )
    expect(choiceLabels(element)).toHaveLength(0)
  })

  it('keeps an inherited effort undefined across a model change', async () => {
    const changes: RoleSetting[] = []
    const element = await render(
      <RoleCard
        meta={BUILDER_META}
        setting={{ model: 'mock/full' }}
        picker={picker}
        onChange={(next) => changes.push(next)}
      />,
    )
    await pickModel(element, 'Narrow')
    expect(changes).toEqual([{ model: 'mock/narrow' }])
  })

  it('clamps a concrete effort when switching to a narrower model', async () => {
    const changes: RoleSetting[] = []
    const element = await render(
      <RoleCard
        meta={BUILDER_META}
        setting={{ model: 'mock/full', effort: EEffortLevel.Medium }}
        picker={picker}
        onChange={(next) => changes.push(next)}
      />,
    )
    await pickModel(element, 'Narrow')
    expect(changes).toEqual([{ model: 'mock/narrow', effort: EEffortLevel.High }])
  })
})
