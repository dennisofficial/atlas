import type { Meta, StoryObj } from '@storybook/react'

import { font } from './index'

const meta = {
  title: 'Foundations/Typography',
  parameters: { layout: 'padded' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const families = [
  {
    name: 'Sans',
    className: 'font-sans',
    stack: font.sans,
    sample: 'Refactor the session store to stream events',
  },
  {
    name: 'Mono',
    className: 'font-mono',
    stack: font.mono,
    sample: 'bun run typecheck --filter @dltech/atlas-ui',
  },
  { name: 'Display', className: 'font-display', stack: font.display, sample: 'Atlas Cloud' },
] as const

const scale = [
  { token: 'text-xs', className: 'text-xs' },
  { token: 'text-sm', className: 'text-sm' },
  { token: 'text-base', className: 'text-base' },
  { token: 'text-lg', className: 'text-lg' },
  { token: 'text-xl', className: 'text-xl' },
  { token: 'text-2xl', className: 'text-2xl' },
  { token: 'text-3xl', className: 'text-3xl' },
  { token: 'text-4xl', className: 'text-4xl' },
] as const

const weights = [
  { token: 'font-normal', className: 'font-normal' },
  { token: 'font-medium', className: 'font-medium' },
  { token: 'font-semibold', className: 'font-semibold' },
  { token: 'font-bold', className: 'font-bold' },
] as const

export const Families: Story = {
  render: () => (
    <div className="flex w-[48rem] max-w-full flex-col gap-6">
      {families.map((family) => (
        <section
          key={family.name}
          className="flex flex-col gap-1 border-b border-border pb-6 last:border-b-0"
        >
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="text-sm font-semibold">{family.name}</h3>
            <code className="font-mono text-xs text-muted-foreground">{family.className}</code>
          </div>
          <p className={`${family.className} text-2xl`}>{family.sample}</p>
          <p className={`${family.className} text-sm text-muted-foreground`}>
            ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground">{family.stack}</p>
        </section>
      ))}
    </div>
  ),
}

export const Scale: Story = {
  render: () => (
    <div className="flex w-[48rem] max-w-full flex-col">
      {scale.map((step) => (
        <div
          key={step.token}
          className="grid grid-cols-[6rem_minmax(0,1fr)] items-baseline gap-4 border-b border-border py-2 last:border-b-0"
        >
          <code className="font-mono text-xs text-muted-foreground">{step.token}</code>
          <span className={`${step.className} truncate`}>Agent session paused for approval</span>
        </div>
      ))}
    </div>
  ),
}

export const Weights: Story = {
  render: () => (
    <div className="flex w-[48rem] max-w-full flex-col">
      {weights.map((weight) => (
        <div
          key={weight.token}
          className="grid grid-cols-[6rem_minmax(0,1fr)] items-baseline gap-4 border-b border-border py-2 last:border-b-0"
        >
          <code className="font-mono text-xs text-muted-foreground">{weight.token}</code>
          <span className={`${weight.className} text-lg`}>Three tool calls awaiting review</span>
        </div>
      ))}
    </div>
  ),
}
