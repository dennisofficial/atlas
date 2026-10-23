import type { Meta, StoryObj } from '@storybook/react'

import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '#components/field'
import { RadioGroup, RadioGroupItem } from '#components/radio-group'

const meta = {
  title: 'Components/Radio Group',
  component: RadioGroup,
} satisfies Meta<typeof RadioGroup>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <FieldSet>
      <FieldLegend variant="label">Approval mode</FieldLegend>
      <RadioGroup defaultValue="ask" {...args}>
        <Field orientation="horizontal">
          <RadioGroupItem value="ask" id="rg-ask" />
          <FieldLabel htmlFor="rg-ask">Ask for every write</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <RadioGroupItem value="edits" id="rg-edits" />
          <FieldLabel htmlFor="rg-edits">Allow edits, ask for bash</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <RadioGroupItem value="all" id="rg-all" />
          <FieldLabel htmlFor="rg-all">Allow everything</FieldLabel>
        </Field>
      </RadioGroup>
    </FieldSet>
  ),
}

export const Disabled: Story = {
  render: (args) => (
    <RadioGroup defaultValue="ask" disabled {...args}>
      <Field orientation="horizontal" data-disabled>
        <RadioGroupItem value="ask" id="rgd-ask" />
        <FieldLabel htmlFor="rgd-ask">Ask for every write</FieldLabel>
      </Field>
      <Field orientation="horizontal" data-disabled>
        <RadioGroupItem value="all" id="rgd-all" />
        <FieldLabel htmlFor="rgd-all">Allow everything</FieldLabel>
      </Field>
    </RadioGroup>
  ),
}

export const Invalid: Story = {
  render: (args) => (
    <RadioGroup {...args}>
      <Field orientation="horizontal" data-invalid>
        <RadioGroupItem value="ask" id="rgi-ask" aria-invalid />
        <FieldLabel htmlFor="rgi-ask">Ask for every write</FieldLabel>
      </Field>
      <FieldDescription>Choose an approval mode to continue.</FieldDescription>
    </RadioGroup>
  ),
}
