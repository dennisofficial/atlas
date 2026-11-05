import type { Meta, StoryObj } from '@storybook/react'

import { DiagramError } from './diagram-error'

const CHART = ['flowchart LR', '  A[Start --> B{Check', '  B -->|yes| C[Done]'].join('\n')

const ERROR =
  "Parse error on line 2:\n...A[Start --> B{Check\n-----------------------^\nExpecting 'SQE', 'DOUBLECIRCLEEND', 'PE', '-)', 'STADIUMEND', 'SUBROUTINEEND', got 'DIAMOND_START'"

const meta = {
  title: 'AI/DiagramError',
  component: DiagramError,
  decorators: [
    (Story) => (
      <div className="w-[40rem] max-w-full text-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DiagramError>

export default meta

type Story = StoryObj<typeof meta>

export const WithoutRepair: Story = {
  args: { chart: CHART, error: ERROR },
}

export const Repairing: Story = {
  args: {
    chart: CHART,
    error: ERROR,
    onRepair: () => new Promise((resolve) => setTimeout(resolve, 1500)),
  },
}

export const RepairFails: Story = {
  args: {
    chart: CHART,
    error: ERROR,
    onRepair: () =>
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('The model is unavailable')), 1500),
      ),
  },
}
