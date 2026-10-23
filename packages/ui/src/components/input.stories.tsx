import type { Meta, StoryObj } from '@storybook/react'

import { Field, FieldDescription, FieldError, FieldLabel } from '#components/field'
import { Input } from '#components/input'

const meta = {
  title: 'Components/Input',
  component: Input,
  argTypes: {
    type: { control: 'select', options: ['text', 'email', 'password', 'number', 'search', 'file'] },
    disabled: { control: 'boolean' },
  },
  args: { type: 'text', placeholder: 'Search sessions' },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Input>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithLabel: Story = {
  render: (args) => (
    <Field>
      <FieldLabel htmlFor="repo-url">Repository URL</FieldLabel>
      <Input id="repo-url" {...args} placeholder="github.com/owner/repo" />
      <FieldDescription>HTTPS or SSH both work.</FieldDescription>
    </Field>
  ),
}

export const Disabled: Story = { args: { disabled: true, defaultValue: 'main' } }

export const Invalid: Story = {
  render: (args) => (
    <Field data-invalid>
      <FieldLabel htmlFor="token">API token</FieldLabel>
      <Input id="token" aria-invalid {...args} defaultValue="sk-expired" />
      <FieldError>This token has expired.</FieldError>
    </Field>
  ),
}

export const File: Story = { args: { type: 'file' } }
