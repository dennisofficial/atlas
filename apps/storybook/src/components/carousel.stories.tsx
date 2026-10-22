import type { Meta, StoryObj } from '@storybook/react-vite'

import { Card, CardContent } from '@dltech/atlas-ui/components/card'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@dltech/atlas-ui/components/carousel'

const meta = {
  title: 'Components/Carousel',
  component: Carousel,
  argTypes: { orientation: { control: 'inline-radio', options: ['horizontal', 'vertical'] } },
  args: { orientation: 'horizontal' },
} satisfies Meta<typeof Carousel>

export default meta

type Story = StoryObj<typeof meta>

const models = ['claude-opus', 'claude-sonnet', 'gpt-5', 'gpt-5-mini', 'gemini-pro']

export const Default: Story = {
  render: (args) => (
    <div className="px-12">
      <Carousel className="w-64" {...args}>
        <CarouselContent>
          {models.map((model) => (
            <CarouselItem key={model}>
              <Card>
                <CardContent className="flex aspect-square items-center justify-center font-mono text-sm">
                  {model}
                </CardContent>
              </Card>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious />
        <CarouselNext />
      </Carousel>
    </div>
  ),
}

export const MultipleVisible: Story = {
  render: (args) => (
    <div className="px-12">
      <Carousel className="w-[28rem]" opts={{ align: 'start' }} {...args}>
        <CarouselContent>
          {models.map((model) => (
            <CarouselItem key={model} className="basis-1/2">
              <Card size="sm">
                <CardContent className="flex h-20 items-center justify-center font-mono text-sm">
                  {model}
                </CardContent>
              </Card>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious />
        <CarouselNext />
      </Carousel>
    </div>
  ),
}
