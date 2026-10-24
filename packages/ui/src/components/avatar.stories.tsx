import type { Meta, StoryObj } from '@storybook/react'

import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from '#components/avatar'

const meta = {
  title: 'Components/Avatar',
  component: Avatar,
  argTypes: { size: { control: 'inline-radio', options: ['xs', 'sm', 'default', 'lg'] } },
  args: { size: 'default' },
} satisfies Meta<typeof Avatar>

export default meta

type Story = StoryObj<typeof meta>

const renderSizedFallback: Story['render'] = (args) => (
  <Avatar {...args}>
    <AvatarFallback>{args.size?.slice(0, 2).toUpperCase()}</AvatarFallback>
  </Avatar>
)

export const Default: Story = {
  render: (args) => (
    <Avatar {...args}>
      <AvatarImage src="https://github.com/shadcn.png" alt="shadcn" />
      <AvatarFallback>CN</AvatarFallback>
    </Avatar>
  ),
}

export const FallbackOnly: Story = {
  render: (args) => (
    <Avatar {...args}>
      <AvatarFallback>DL</AvatarFallback>
    </Avatar>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      {(['xs', 'sm', 'default', 'lg'] as const).map((size) => (
        <Avatar key={size} size={size}>
          <AvatarFallback>{size.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      ))}
    </div>
  ),
}

export const ExtraSmall: Story = { args: { size: 'xs' }, render: renderSizedFallback }

export const Small: Story = { args: { size: 'sm' }, render: renderSizedFallback }

export const Large: Story = { args: { size: 'lg' }, render: renderSizedFallback }

export const WithBadge: Story = {
  render: (args) => (
    <Avatar {...args}>
      <AvatarFallback>AT</AvatarFallback>
      <AvatarBadge className="bg-success" />
    </Avatar>
  ),
}

export const Group: Story = {
  render: () => (
    <AvatarGroup>
      {['DL', 'MK', 'RS'].map((initials) => (
        <Avatar key={initials}>
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      ))}
      <AvatarGroupCount>+4</AvatarGroupCount>
    </AvatarGroup>
  ),
}
