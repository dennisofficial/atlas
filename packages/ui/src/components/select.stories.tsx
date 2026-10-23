import type { Meta, StoryObj } from '@storybook/react'

import { Field, FieldError, FieldLabel } from '#components/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '#components/select'

const meta = {
  title: 'Components/Select',
  component: Select,
} satisfies Meta<typeof Select>

export default meta

type Story = StoryObj<typeof meta>

function Options() {
  return (
    <SelectContent>
      <SelectGroup>
        <SelectLabel>Anthropic</SelectLabel>
        <SelectItem value="opus">claude-opus</SelectItem>
        <SelectItem value="sonnet">claude-sonnet</SelectItem>
      </SelectGroup>
      <SelectSeparator />
      <SelectGroup>
        <SelectLabel>OpenAI</SelectLabel>
        <SelectItem value="gpt5">gpt-5</SelectItem>
        <SelectItem value="gpt5-mini">gpt-5-mini</SelectItem>
      </SelectGroup>
    </SelectContent>
  )
}

const items = [
  { value: 'opus', label: 'claude-opus' },
  { value: 'sonnet', label: 'claude-sonnet' },
  { value: 'gpt5', label: 'gpt-5' },
  { value: 'gpt5-mini', label: 'gpt-5-mini' },
]

export const Default: Story = {
  render: (args) => (
    <Select items={items} {...args}>
      <SelectTrigger className="w-56" aria-label="Model">
        <SelectValue placeholder="Select a model" />
      </SelectTrigger>
      <Options />
    </Select>
  ),
}

export const Small: Story = {
  render: (args) => (
    <Select items={items} defaultValue="sonnet" {...args}>
      <SelectTrigger size="sm" className="w-48" aria-label="Model">
        <SelectValue />
      </SelectTrigger>
      <Options />
    </Select>
  ),
}

export const Disabled: Story = {
  render: (args) => (
    <Select items={items} defaultValue="opus" disabled {...args}>
      <SelectTrigger className="w-56" aria-label="Model">
        <SelectValue />
      </SelectTrigger>
      <Options />
    </Select>
  ),
}

export const Invalid: Story = {
  render: (args) => (
    <Field data-invalid className="w-56">
      <FieldLabel htmlFor="select-invalid">Model</FieldLabel>
      <Select items={items} {...args}>
        <SelectTrigger id="select-invalid" aria-invalid>
          <SelectValue placeholder="Select a model" />
        </SelectTrigger>
        <Options />
      </Select>
      <FieldError>Choose a model.</FieldError>
    </Field>
  ),
}
