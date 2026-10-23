import type { Meta, StoryObj } from '@storybook/react'

import { Field, FieldContent, FieldDescription, FieldLabel } from '#components/field'
import { Switch } from '#components/switch'

const meta = {
  title: 'Components/Switch',
  component: Switch,
  argTypes: {
    size: { control: 'inline-radio', options: ['default', 'sm'] },
    disabled: { control: 'boolean' },
  },
  args: { size: 'default' },
} satisfies Meta<typeof Switch>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Field orientation="horizontal" className="w-80">
      <FieldContent>
        <FieldLabel htmlFor="sw-stream">Stream tool output</FieldLabel>
        <FieldDescription>Show command output as it arrives.</FieldDescription>
      </FieldContent>
      <Switch id="sw-stream" defaultChecked {...args} />
    </Field>
  ),
}

export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Field orientation="horizontal">
        <Switch id="sw-off" />
        <FieldLabel htmlFor="sw-off">Off</FieldLabel>
      </Field>
      <Field orientation="horizontal">
        <Switch id="sw-on" defaultChecked />
        <FieldLabel htmlFor="sw-on">On</FieldLabel>
      </Field>
      <Field orientation="horizontal">
        <Switch id="sw-sm" size="sm" defaultChecked />
        <FieldLabel htmlFor="sw-sm">Small</FieldLabel>
      </Field>
      <Field orientation="horizontal" data-disabled>
        <Switch id="sw-dis" disabled />
        <FieldLabel htmlFor="sw-dis">Disabled</FieldLabel>
      </Field>
      <Field orientation="horizontal" data-invalid>
        <Switch id="sw-inv" aria-invalid />
        <FieldLabel htmlFor="sw-inv">Invalid</FieldLabel>
      </Field>
    </div>
  ),
}
