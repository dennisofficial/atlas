import type { Meta, StoryObj } from '@storybook/react'

import { BrandMark, EBrand } from '#components/brand-mark'

const meta = {
  title: 'Components/Brand Mark',
  component: BrandMark,
  args: { brand: EBrand.Claude },
  argTypes: {
    brand: { control: 'select', options: Object.values(EBrand) },
    size: { control: 'inline-radio', options: ['default', 'sm'] },
  },
} satisfies Meta<typeof BrandMark>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Anthropic: Story = { args: { brand: EBrand.Anthropic } }

export const OpenAI: Story = { args: { brand: EBrand.OpenAI } }

export const OpenRouter: Story = { args: { brand: EBrand.OpenRouter } }

export const Inference: Story = { args: { brand: EBrand.Inference } }

export const Vercel: Story = { args: { brand: EBrand.Vercel } }

export const GitHub: Story = { args: { brand: EBrand.GitHub } }

export const Linear: Story = { args: { brand: EBrand.Linear } }

export const Gemini: Story = { args: { brand: EBrand.Gemini } }

export const Sentry: Story = { args: { brand: EBrand.Sentry } }

export const PostHog: Story = { args: { brand: EBrand.PostHog } }

export const Neon: Story = { args: { brand: EBrand.Neon } }

export const Stripe: Story = { args: { brand: EBrand.Stripe } }

export const Notion: Story = { args: { brand: EBrand.Notion } }

export const Figma: Story = { args: { brand: EBrand.Figma } }

export const AllBrands: Story = {
  render: () => (
    <div className="grid grid-cols-7 gap-3">
      {Object.values(EBrand).map((brand) => (
        <div key={brand} className="flex flex-col items-center gap-1.5">
          <BrandMark brand={brand} />
          <span className="text-xs text-muted-foreground">{brand}</span>
        </div>
      ))}
    </div>
  ),
}

export const Small: Story = { args: { size: 'sm' } }
