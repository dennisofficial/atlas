import type { Meta, StoryObj } from '@storybook/react'

import { Checkbox } from '#components/checkbox'
import { Field, FieldContent, FieldDescription, FieldLabel } from '#components/field'

const meta = {
  title: 'Components/Checkbox',
  component: Checkbox,
} satisfies Meta<typeof Checkbox>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Field orientation="horizontal">
      <Checkbox id="terms" {...args} />
      <FieldLabel htmlFor="terms">Allow edits without asking</FieldLabel>
    </Field>
  ),
}

export const WithDescription: Story = {
  render: (args) => (
    <Field orientation="horizontal" className="w-80">
      <Checkbox id="auto-commit" defaultChecked {...args} />
      <FieldContent>
        <FieldLabel htmlFor="auto-commit">Commit after each turn</FieldLabel>
        <FieldDescription>Creates a checkpoint commit on the session branch.</FieldDescription>
      </FieldContent>
    </Field>
  ),
}

export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Field orientation="horizontal">
        <Checkbox id="unchecked" />
        <FieldLabel htmlFor="unchecked">Unchecked</FieldLabel>
      </Field>
      <Field orientation="horizontal">
        <Checkbox id="checked" defaultChecked />
        <FieldLabel htmlFor="checked">Checked</FieldLabel>
      </Field>
      <Field orientation="horizontal">
        <Checkbox id="indeterminate" indeterminate />
        <FieldLabel htmlFor="indeterminate">Indeterminate</FieldLabel>
      </Field>
      <Field orientation="horizontal" data-disabled>
        <Checkbox id="disabled" disabled />
        <FieldLabel htmlFor="disabled">Disabled</FieldLabel>
      </Field>
      <Field orientation="horizontal" data-invalid>
        <Checkbox id="invalid" aria-invalid />
        <FieldLabel htmlFor="invalid">Invalid</FieldLabel>
      </Field>
    </div>
  ),
}
