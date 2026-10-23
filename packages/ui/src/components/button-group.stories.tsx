import type { Meta, StoryObj } from '@storybook/react'
import { ChevronDownIcon } from 'lucide-react'

import { Button } from '#components/button'
import { ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from '#components/button-group'

const meta = {
  title: 'Components/Button Group',
  component: ButtonGroup,
  argTypes: { orientation: { control: 'inline-radio', options: ['horizontal', 'vertical'] } },
  args: { orientation: 'horizontal' },
} satisfies Meta<typeof ButtonGroup>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <ButtonGroup {...args}>
      <Button variant="outline">Approve</Button>
      <Button variant="outline">Deny</Button>
      <Button variant="outline">Always allow</Button>
    </ButtonGroup>
  ),
}

export const WithSeparatorAndMenu: Story = {
  render: (args) => (
    <ButtonGroup {...args}>
      <Button variant="secondary">Run session</Button>
      <ButtonGroupSeparator />
      <Button variant="secondary" size="icon" aria-label="More run options">
        <ChevronDownIcon />
      </Button>
    </ButtonGroup>
  ),
}

export const WithText: Story = {
  render: (args) => (
    <ButtonGroup {...args}>
      <ButtonGroupText>Branch</ButtonGroupText>
      <Button variant="outline">dennis/shadcn-ui-storybook</Button>
    </ButtonGroup>
  ),
}

export const Vertical: Story = {
  args: { orientation: 'vertical' },
  render: (args) => (
    <ButtonGroup {...args}>
      <Button variant="outline">Sessions</Button>
      <Button variant="outline">Tools</Button>
      <Button variant="outline">Settings</Button>
    </ButtonGroup>
  ),
}
