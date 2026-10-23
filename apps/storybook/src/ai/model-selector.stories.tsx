import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { EEffort, ModelSelector, type ModelOption } from '@dltech/atlas-ui/ai/model-selector'
import { InputGroup, InputGroupAddon } from '@dltech/atlas-ui/components/input-group'

import { MODELS } from '../fixtures/agent'
import MODEL_CATALOGUE from '../fixtures/model-catalogue.json'
import { PROVIDER_LABELS } from '../fixtures/settings-models'
import {
  CATALOGUE_MODELS,
  contextLabel,
  familyMark,
  priceLabel,
} from '../fixtures/settings-models-catalogue'

const CATALOGUE: ModelOption[] = MODEL_CATALOGUE

const SCALE_ROUTES = ['Anthropic', 'OpenAI', 'OpenRouter', 'Inference.net', 'AI Gateway']

const SCALE_MODELS: ModelOption[] = [
  {
    id: 'auto',
    label: 'Claude Opus 4.7',
    provider: 'Automatic',
    auto: true,
    route: 'Max',
    efforts: [EEffort.Low, EEffort.Medium, EEffort.High, EEffort.XHigh, EEffort.Max],
  },
  ...SCALE_ROUTES.flatMap((route) =>
    CATALOGUE_MODELS.flatMap((model) =>
      model.rows
        .filter((row) => PROVIDER_LABELS[row.provider] === route)
        .map((row) => ({
          id: row.ref,
          label: row.label,
          provider: route,
          context: contextLabel(row.contextWindow),
          contextTokens: row.contextWindow,
          rate: priceLabel(row.cost),
          images: row.images,
          efforts: row.efforts,
          brand: familyMark(model.vendor).brand,
          monogram: familyMark(model.vendor).monogram,
        })),
    ),
  ),
]

const RECONNECT_PROVIDERS = ['OpenRouter']

const DEFAULT_PINNED = ['anthropic/claude-sonnet-5', 'anthropic/claude-opus-5', 'openai/gpt-5.5']

const meta = {
  title: 'AI/Model Selector',
  component: ModelSelector,
  args: { models: MODELS, value: 'claude-sonnet' },
} satisfies Meta<typeof ModelSelector>

export default meta

type Story = StoryObj<typeof meta>

function SelectorDemo({ withEffort }: { withEffort: boolean }) {
  const [model, setModel] = useState('claude-sonnet')
  const [effort, setEffort] = useState(EEffort.Medium)

  return (
    <InputGroup className="w-96">
      <InputGroupAddon align="block-end">
        <ModelSelector
          models={MODELS}
          value={model}
          onValueChange={setModel}
          effort={withEffort ? effort : undefined}
          onEffortChange={setEffort}
        />
      </InputGroupAddon>
    </InputGroup>
  )
}

function CatalogueDemo({
  models,
  defaultOpen,
  initialPinned,
  reconnectProviders,
}: {
  models: ModelOption[]
  defaultOpen: boolean
  initialPinned: string[]
  reconnectProviders: string[]
}) {
  const [model, setModel] = useState('anthropic/claude-sonnet-5')
  const [effort, setEffort] = useState(EEffort.Medium)
  const [pinned, setPinned] = useState(initialPinned)
  const [lastAction, setLastAction] = useState('')

  const handleReconnect = (provider: string) => setLastAction(`Reconnect ${provider}`)
  const handleManageProviders = () => setLastAction('Manage providers')

  return (
    <div className="flex h-[640px] w-[28rem] flex-col items-start gap-2">
      <InputGroup>
        <InputGroupAddon align="block-end">
          <ModelSelector
            models={models}
            value={model}
            onValueChange={setModel}
            effort={effort}
            onEffortChange={setEffort}
            pinned={pinned}
            onPinnedChange={setPinned}
            reconnectProviders={reconnectProviders}
            onReconnect={handleReconnect}
            onManageProviders={handleManageProviders}
            defaultOpen={defaultOpen}
          />
        </InputGroupAddon>
      </InputGroup>
      {lastAction ? (
        <p className="text-xs text-muted-foreground">Last action: {lastAction}</p>
      ) : null}
    </div>
  )
}

export const ModelOnly: Story = { render: () => <SelectorDemo withEffort={false} /> }

export const ModelAndEffort: Story = { render: () => <SelectorDemo withEffort /> }

export const FullCatalogue: Story = {
  render: () => (
    <CatalogueDemo
      models={CATALOGUE}
      defaultOpen={false}
      initialPinned={DEFAULT_PINNED}
      reconnectProviders={RECONNECT_PROVIDERS}
    />
  ),
}

export const FullCatalogueOpen: Story = {
  render: () => (
    <CatalogueDemo
      models={CATALOGUE}
      defaultOpen
      initialPinned={DEFAULT_PINNED}
      reconnectProviders={RECONNECT_PROVIDERS}
    />
  ),
}

export const FullCatalogueNoPins: Story = {
  render: () => (
    <CatalogueDemo
      models={CATALOGUE}
      defaultOpen
      initialPinned={[]}
      reconnectProviders={RECONNECT_PROVIDERS}
    />
  ),
}

export const NoProviders: Story = {
  render: () => (
    <CatalogueDemo models={[]} defaultOpen initialPinned={[]} reconnectProviders={[]} />
  ),
}

function ScaleDemo({ defaultOpen }: { defaultOpen: boolean }) {
  const [model, setModel] = useState('auto')
  const [effort, setEffort] = useState(EEffort.High)
  const [pinned, setPinned] = useState(['anthropic/claude-opus-4-7', 'openai/gpt-5'])

  return (
    <div className="flex h-[640px] w-[28rem] flex-col items-start">
      <InputGroup>
        <InputGroupAddon align="block-end">
          <ModelSelector
            models={SCALE_MODELS}
            value={model}
            onValueChange={setModel}
            effort={effort}
            onEffortChange={setEffort}
            pinned={pinned}
            onPinnedChange={setPinned}
            collapsedProviders={['OpenRouter', 'Inference.net', 'AI Gateway']}
            reconnectProviders={[]}
            onManageProviders={() => undefined}
            defaultOpen={defaultOpen}
          />
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

export const AtScale: Story = { render: () => <ScaleDemo defaultOpen={false} /> }

export const AtScaleOpen: Story = { render: () => <ScaleDemo defaultOpen /> }
