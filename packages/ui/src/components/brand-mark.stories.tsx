import type { Meta, StoryObj } from '@storybook/react'

import { BrandMark, EBrand } from '#components/brand-mark'

const meta = {
  title: 'Components/Brand Mark',
  component: BrandMark,
  args: { brand: EBrand.Claude },
  argTypes: { brand: { control: 'select', options: Object.values(EBrand) } },
} satisfies Meta<typeof BrandMark>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

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
