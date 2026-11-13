import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

import { InputGroup, InputGroupAddon } from '#components/input-group'
import { ModelSelector } from './model-selector'
import type { ModelOption } from './model-selector-groups'
import { EEffort } from './model-selector-groups'
import { EffortDial, EffortGauge } from './effort-dial'

const EFFORTS = [EEffort.Low, EEffort.Medium, EEffort.High, EEffort.XHigh, EEffort.Max]

const LADDERS: { caption: string; efforts: EEffort[] }[] = [
  { caption: '3 rungs', efforts: [EEffort.Low, EEffort.Medium, EEffort.High] },
  { caption: '5 rungs', efforts: EFFORTS },
  {
    caption: '7 rungs',
    efforts: [
      EEffort.Off,
      EEffort.Minimal,
      EEffort.Low,
      EEffort.Medium,
      EEffort.High,
      EEffort.XHigh,
      EEffort.Max,
    ],
  },
]

function Ladder({ efforts, initial }: { efforts: EEffort[]; initial: EEffort }) {
  const [value, setValue] = useState(initial)
  return <EffortDial efforts={efforts} value={value} onChange={setValue} />
}

const meta = {
  title: 'AI/Effort dial',
  component: EffortDial,
  args: { efforts: EFFORTS, value: EEffort.Medium },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof EffortDial>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const InComposer: Story = {
  render: () => {
    const [effort, setEffort] = useState(EEffort.High)
    const models: ModelOption[] = [
      {
        id: 'anthropic/claude-opus-4.7',
        label: 'Claude Opus 4.7',
        provider: 'Anthropic',
        efforts: EFFORTS,
      },
    ]
    return (
      <InputGroup className="w-96">
        <InputGroupAddon align="block-end">
          <ModelSelector
            models={models}
            value="anthropic/claude-opus-4.7"
            effort={effort}
            onEffortChange={setEffort}
          />
        </InputGroupAddon>
      </InputGroup>
    )
  },
}

export const VisibleLabel: Story = {
  render: () => {
    const [effort, setEffort] = useState(EEffort.High)
    const models: ModelOption[] = [
      {
        id: 'anthropic/claude-opus-4.7',
        label: 'Claude Opus 4.7',
        provider: 'Anthropic',
        efforts: EFFORTS,
      },
    ]
    return (
      <InputGroup className="w-96">
        <InputGroupAddon>
          <ModelSelector
            models={models}
            value="anthropic/claude-opus-4.7"
            effort={effort}
            onEffortChange={setEffort}
            showEffortLabel
          />
        </InputGroupAddon>
      </InputGroup>
    )
  },
}

export const EveryLadder: Story = {
  render: () => (
    <InputGroup className="w-96">
      <InputGroupAddon align="block-end">
        {LADDERS.map(({ caption, efforts }) => (
          <span key={caption} className="flex items-center gap-1 text-xs text-muted-foreground">
            <Ladder efforts={efforts} initial={efforts[1] ?? EEffort.Low} />
            {caption}
          </span>
        ))}
      </InputGroupAddon>
    </InputGroup>
  ),
}

export const GaugeRungs: Story = {
  render: () => (
    <div className="flex items-end gap-3">
      {EFFORTS.map((effort) => (
        <div key={effort} className="flex flex-col items-center gap-1 text-muted-foreground">
          <EffortGauge efforts={EFFORTS} value={effort} className="size-6" />
          <span className="text-xs">{effort}</span>
        </div>
      ))}
    </div>
  ),
}
