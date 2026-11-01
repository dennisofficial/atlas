import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { Command, CommandList } from '#components/command'

import { ModelRow } from '../internal/model-selector-rows'
import {
  EProviderGroupKind,
  firstItemValue,
  modelSelectorGroups,
  type ModelOption,
} from '../model-selector-groups'

const MODELS: ModelOption[] = [
  { id: 'anthropic/sonnet', label: 'Sonnet', provider: 'Claude Plan' },
  {
    id: 'openai/gpt',
    label: 'GPT',
    provider: 'Codex Plan',
    disabled: true,
    disabledNote: 'no key',
  },
  { id: 'openai/o3', label: 'o3', provider: 'Codex Plan', disabled: true, disabledNote: 'no key' },
]

const renderRow = (model: ModelOption, canPin = true) =>
  renderToStaticMarkup(
    <Command label="Models">
      <CommandList>
        <ModelRow
          model={model}
          checked={false}
          pinned={false}
          canPin={canPin}
          showRate
          showRoute={false}
          onSelect={() => undefined}
          onTogglePin={() => undefined}
        />
      </CommandList>
    </Command>,
  )

describe('disabled model options', () => {
  it('keeps a provider whose models are all disabled as a visible group', () => {
    const groups = modelSelectorGroups({ models: MODELS })
    const dormant = groups.providers.find((group) => group.provider === 'Codex Plan')

    expect(dormant?.kind).toBe(EProviderGroupKind.Models)
    expect(dormant?.kind === EProviderGroupKind.Models && dormant.models).toHaveLength(2)
  })

  it('never lifts a disabled model into the pinned group', () => {
    const groups = modelSelectorGroups({
      models: MODELS,
      pinned: ['openai/gpt', 'anthropic/sonnet'],
    })

    expect(groups.pinned.map((model) => model.id)).toEqual(['anthropic/sonnet'])
    expect(
      groups.providers.find((group) => group.provider === 'Codex Plan')?.kind ===
        EProviderGroupKind.Models,
    ).toBe(true)
  })

  it('highlights the first enabled item, skipping a leading disabled group', () => {
    const groups = modelSelectorGroups({ models: [...MODELS].reverse() })

    expect(firstItemValue(groups)).toBe('anthropic/sonnet')
  })

  it('has no first item when every model is disabled and nothing can be managed', () => {
    const groups = modelSelectorGroups({ models: MODELS.filter((model) => model.disabled) })

    expect(firstItemValue(groups)).toBeUndefined()
  })

  it('still finds a disabled model by search', () => {
    const groups = modelSelectorGroups({ models: MODELS, query: 'o3' })

    expect(groups.providers.map((group) => group.provider)).toEqual(['Codex Plan'])
  })
})

describe('ModelRow disabled', () => {
  it('renders an aria-disabled row with the no-key note and no pin button', () => {
    const html = renderRow(MODELS[1] as ModelOption)

    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('no key')
    expect(html).not.toContain('Pin GPT')
  })

  it('renders an enabled row selectable with its pin button', () => {
    const html = renderRow(MODELS[0] as ModelOption)

    expect(html).toContain('aria-disabled="false"')
    expect(html).toContain('Pin Sonnet')
    expect(html).not.toContain('no key')
  })
})
