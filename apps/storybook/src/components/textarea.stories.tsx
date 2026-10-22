import type { Meta, StoryObj } from '@storybook/react-vite'

import { Field, FieldDescription, FieldError, FieldLabel } from '@dltech/atlas-ui/components/field'
import { Textarea } from '@dltech/atlas-ui/components/textarea'

const meta = {
  title: 'Components/Textarea',
  component: Textarea,
  args: { placeholder: 'Describe what Atlas should do' },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Textarea>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithLabel: Story = {
  render: (args) => (
    <Field>
      <FieldLabel htmlFor="task">Task</FieldLabel>
      <Textarea id="task" {...args} />
      <FieldDescription>Include file paths where you can.</FieldDescription>
    </Field>
  ),
}

export const Disabled: Story = {
  args: { disabled: true, defaultValue: 'Locked while the session runs.' },
}

export const Invalid: Story = {
  render: (args) => (
    <Field data-invalid>
      <FieldLabel htmlFor="task-invalid">Task</FieldLabel>
      <Textarea id="task-invalid" aria-invalid {...args} />
      <FieldError>A task is required.</FieldError>
    </Field>
  ),
}
