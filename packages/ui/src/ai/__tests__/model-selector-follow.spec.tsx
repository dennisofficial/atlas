import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import type { ReactElement } from 'react'
import { act } from 'react'

GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { ModelSelector } = await import('../model-selector')
const { EEffort } = await import('../model-selector-groups')

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

let root: { render: (node: ReactElement) => void; unmount: () => void } | null = null

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

const MODELS = [
  {
    id: 'gateway/deepseek/deepseek-v4.1-flash-1017',
    label: 'DeepSeek V4.1 Flash',
    provider: 'AI Gateway',
    efforts: [EEffort.Off, EEffort.Low, EEffort.High, EEffort.Max],
    effortLabels: { [EEffort.Off]: 'None', [EEffort.Low]: 'Low', [EEffort.High]: 'High' },
    fast: true,
  },
  {
    id: 'anthropic/claude-opus-5',
    label: 'Claude Opus 5',
    provider: 'Anthropic',
    efforts: [EEffort.Low, EEffort.Medium, EEffort.High],
  },
]

const STALE_MODELS = [
  {
    id: 'anthropic/claude-opus-5',
    label: 'Claude Opus 5',
    provider: 'Anthropic',
    efforts: [EEffort.Low, EEffort.Medium, EEffort.High],
    disabled: true,
    disabledNote: 'No key for Anthropic',
  },
]

const FOLLOW = {
  label: 'Follow main agent',
  active: true,
  onFollow: () => undefined,
  note: 'Follows main agent',
}

async function mount(element: ReactElement) {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(element))
}

const optionsOf = () => [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]

const optionNamed = (text: string) =>
  optionsOf().find((option) => option.textContent?.includes(text))

const click = async (element: Element | null | undefined) => {
  await act(async () => (element as HTMLElement | null)?.click())
}

describe('ModelSelector follow mode', () => {
  it('opens on a checked follow row with the model muted and the dial read-only', async () => {
    await mount(
      <ModelSelector
        models={MODELS}
        value={MODELS[0]?.id ?? ''}
        effort={EEffort.High}
        onEffortChange={() => undefined}
        fast={false}
        onFastChange={() => undefined}
        follow={FOLLOW}
        defaultOpen
      />,
    )

    expect(optionNamed('Follow main agent')?.dataset.checked).toBe('true')
    expect(document.body.innerHTML).toContain('Follow main agent')
    expect(
      document.body.querySelector('[data-slot="model-effort"]')?.getAttribute('data-read-only'),
    ).toBe('')
  })

  it('shows a read-only pressed fast toggle on a following row of a fast model', async () => {
    const toggled: boolean[] = []
    await mount(
      <ModelSelector
        models={MODELS}
        value={MODELS[0]?.id ?? ''}
        effort={EEffort.High}
        fast
        onFastChange={(fast) => void toggled.push(fast)}
        follow={FOLLOW}
      />,
    )

    const fast = document.body.querySelector('[data-slot="model-fast"]')

    expect(fast?.getAttribute('data-read-only')).toBe('')
    expect(fast?.getAttribute('aria-pressed')).toBe('true')
    expect(fast?.getAttribute('aria-disabled')).toBe('true')
    expect(fast?.getAttribute('title')).toBe('Follows main agent')
    expect(fast?.className).toContain('text-muted-foreground')
    await click(fast)
    expect(toggled).toEqual([])
  })

  it('shows no fast toggle on a following row when the model has none', async () => {
    await mount(
      <ModelSelector
        models={MODELS}
        value={MODELS[1]?.id ?? ''}
        effort={EEffort.High}
        fast
        onFastChange={() => undefined}
        follow={FOLLOW}
      />,
    )

    expect(document.body.querySelector('[data-slot="model-fast"]')).toBeNull()
  })

  it('calls onFollow when the follow row is picked', async () => {
    const followed: string[] = []
    await mount(
      <ModelSelector
        models={MODELS}
        value={MODELS[0]?.id ?? ''}
        effort={EEffort.High}
        follow={{ ...FOLLOW, onFollow: () => void followed.push('follow') }}
        defaultOpen
      />,
    )

    await click(optionNamed('Follow main agent'))

    expect(followed).toEqual(['follow'])
  })

  it('hangs the follow marker outside the trigger and keeps its accessible name', async () => {
    await mount(
      <ModelSelector
        models={MODELS}
        value={MODELS[0]?.id ?? ''}
        effort={EEffort.High}
        follow={FOLLOW}
      />,
    )

    const marker = document.body.querySelector('[data-slot="model-follow"]')
    const trigger = document.body.querySelector('button[data-slot="model-trigger"]')

    expect(marker).not.toBeNull()
    expect(trigger).not.toBeNull()
    expect(trigger?.contains(marker)).toBe(false)
    expect(trigger?.textContent).toContain('Follow main agent')
  })

  it('draws no marker and an unmuted label when the follow is inactive', async () => {
    await mount(
      <ModelSelector
        models={MODELS}
        value={MODELS[0]?.id ?? ''}
        effort={EEffort.High}
        follow={{ ...FOLLOW, active: false }}
      />,
    )

    const label = [...document.body.querySelectorAll('span')].find(
      (span) => span.textContent === 'DeepSeek V4.1 Flash',
    )

    expect(label).toBeDefined()
    expect(label?.className).not.toContain('text-muted-foreground')
    expect(document.body.textContent).not.toContain('Follow main agent')
    expect(document.body.querySelector('[data-slot="model-follow"]')).toBeNull()
    expect(document.body.querySelector('button[data-slot="model-trigger"]')).not.toBeNull()
  })

  it('overrides by picking a model from the list', async () => {
    const picked: string[] = []
    await mount(
      <ModelSelector
        models={MODELS}
        value={MODELS[0]?.id ?? ''}
        effort={EEffort.High}
        onValueChange={(id) => void picked.push(id)}
        follow={FOLLOW}
        defaultOpen
      />,
    )

    await click(optionNamed('Claude Opus 5'))

    expect(picked).toEqual(['anthropic/claude-opus-5'])
  })

  it('shows the note and a disabled slider in the read-only dial', async () => {
    await mount(
      <ModelSelector
        models={MODELS}
        value={MODELS[0]?.id ?? ''}
        effort={EEffort.High}
        follow={FOLLOW}
      />,
    )

    await click(document.body.querySelector('button[data-slot="model-effort"]'))

    expect(document.body.textContent).toContain('Follows main agent')
    expect(
      document.body.querySelector('[data-slot="slider"]')?.getAttribute('data-disabled'),
    ).not.toBeNull()
  })

  it('draws no warning triangle on a follower of a stale model but keeps its note', async () => {
    await mount(
      <ModelSelector
        models={STALE_MODELS}
        value="anthropic/claude-opus-5"
        effort={EEffort.High}
        follow={FOLLOW}
      />,
    )

    const trigger = document.body.querySelector('button[data-slot="model-trigger"]')
    const triangles = [...(trigger?.querySelectorAll('svg') ?? [])].filter((svg) =>
      svg.getAttribute('class')?.includes('text-warning'),
    )

    expect(triangles).toEqual([])
    expect(trigger?.textContent).toContain('No key for Anthropic')
  })

  it('names the rung in the model own words on the trigger', async () => {
    await mount(
      <ModelSelector
        models={MODELS}
        value={MODELS[0]?.id ?? ''}
        effort={EEffort.Off}
        onEffortChange={() => undefined}
      />,
    )

    expect(
      document.body.querySelector('button[data-slot="model-effort"]')?.getAttribute('aria-label'),
    ).toBe('Effort: None')
  })
})
