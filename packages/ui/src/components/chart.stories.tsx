import type { Meta, StoryObj } from '@storybook/react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis } from 'recharts'

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '#components/chart'

const meta = {
  title: 'Components/Chart',
  component: ChartContainer,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ChartContainer>

export default meta

type Story = StoryObj<typeof meta>

const usage = [
  { day: 'Mon', opus: 186, sonnet: 80 },
  { day: 'Tue', opus: 305, sonnet: 200 },
  { day: 'Wed', opus: 237, sonnet: 120 },
  { day: 'Thu', opus: 73, sonnet: 190 },
  { day: 'Fri', opus: 209, sonnet: 130 },
  { day: 'Sat', opus: 114, sonnet: 90 },
  { day: 'Sun', opus: 160, sonnet: 140 },
]

const config = {
  opus: { label: 'claude-opus', color: 'var(--chart-1)' },
  sonnet: { label: 'claude-sonnet', color: 'var(--chart-2)' },
} satisfies ChartConfig

export const Bars: Story = {
  args: { config, children: <div /> },
  render: () => (
    <ChartContainer config={config} className="h-64 w-[32rem] max-w-full">
      <BarChart data={usage} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="opus" fill="var(--color-opus)" radius={4} />
        <Bar dataKey="sonnet" fill="var(--color-sonnet)" radius={4} />
      </BarChart>
    </ChartContainer>
  ),
}

export const Areas: Story = {
  args: { config, children: <div /> },
  render: () => (
    <ChartContainer config={config} className="h-64 w-[32rem] max-w-full">
      <AreaChart data={usage} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <Area
          dataKey="sonnet"
          type="natural"
          fill="var(--color-sonnet)"
          fillOpacity={0.3}
          stroke="var(--color-sonnet)"
          stackId="a"
        />
        <Area
          dataKey="opus"
          type="natural"
          fill="var(--color-opus)"
          fillOpacity={0.3}
          stroke="var(--color-opus)"
          stackId="a"
        />
      </AreaChart>
    </ChartContainer>
  ),
}
