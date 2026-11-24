import type { Meta, StoryObj } from '@storybook/react'

import { DiagramMessageScope, DiagramRepairProvider, MermaidErrorView } from './diagram-repair'

const CHART = ['flowchart LR', '  A[Start --> B{Check', '  B -->|yes| C[Done]'].join('\n')

const ERROR =
  "Parse error on line 2:\n...A[Start --> B{Check\n-----------------------^\nExpecting 'SQE', 'PE', got 'DIAMOND_START'"

const MESSAGE = { text: `\`\`\`mermaid\n${CHART}\n\`\`\``, messageId: 'message-1' }

const meta = {
  title: 'AI/DiagramRepair',
  component: MermaidErrorView,
  decorators: [
    (Story) => (
      <div className="w-[40rem] max-w-full text-sm">
        <Story />
      </div>
    ),
  ],
  args: { chart: CHART, error: ERROR },
} satisfies Meta<typeof MermaidErrorView>

export default meta

type Story = StoryObj<typeof meta>

export const WithoutProvider: Story = {}

export const InRepairScope: Story = {
  decorators: [
    (Story) => (
      <DiagramRepairProvider repair={() => new Promise((resolve) => setTimeout(resolve, 1500))}>
        <DiagramMessageScope message={MESSAGE}>
          <Story />
        </DiagramMessageScope>
      </DiagramRepairProvider>
    ),
  ],
}
