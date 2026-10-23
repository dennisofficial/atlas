import type { Meta, StoryObj } from '@storybook/react'

import { Button } from '#components/button'
import { Checkbox } from '#components/checkbox'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from '#components/field'
import { Input } from '#components/input'
import { RadioGroup, RadioGroupItem } from '#components/radio-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/select'
import { Switch } from '#components/switch'
import { Textarea } from '#components/textarea'

const meta = {
  title: 'Components/Field',
  component: Field,
  argTypes: {
    orientation: { control: 'inline-radio', options: ['vertical', 'horizontal', 'responsive'] },
  },
  args: { orientation: 'vertical' },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Field>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Field className="w-80" {...args}>
      <FieldLabel htmlFor="branch">Branch</FieldLabel>
      <Input id="branch" placeholder="dennis/my-change" />
      <FieldDescription>Atlas creates this branch from origin/main.</FieldDescription>
    </Field>
  ),
}

export const Invalid: Story = {
  render: (args) => (
    <Field className="w-80" data-invalid {...args}>
      <FieldLabel htmlFor="branch-invalid">Branch</FieldLabel>
      <Input id="branch-invalid" aria-invalid defaultValue="my change" />
      <FieldError>Branch names cannot contain spaces.</FieldError>
    </Field>
  ),
}

export const Disabled: Story = {
  render: (args) => (
    <Field className="w-80" data-disabled {...args}>
      <FieldLabel htmlFor="branch-disabled">Branch</FieldLabel>
      <Input id="branch-disabled" disabled defaultValue="main" />
      <FieldDescription>Locked while a session is running.</FieldDescription>
    </Field>
  ),
}

export const Horizontal: Story = {
  render: () => (
    <Field orientation="horizontal" className="w-96">
      <FieldContent>
        <FieldLabel htmlFor="autoapprove">Auto-approve reads</FieldLabel>
        <FieldDescription>Skip the prompt for read-only tools.</FieldDescription>
      </FieldContent>
      <Switch id="autoapprove" />
    </Field>
  ),
}

export const Form: Story = {
  render: () => (
    <form className="w-[28rem]">
      <FieldGroup>
        <FieldSet>
          <FieldLegend>New session</FieldLegend>
          <FieldDescription>
            Configure what Atlas works on and how much freedom it has.
          </FieldDescription>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="form-repo">Repository</FieldLabel>
              <Input id="form-repo" defaultValue="dennisofficial/atlas" />
            </Field>
            <Field>
              <FieldLabel htmlFor="form-model">Model</FieldLabel>
              <Select defaultValue="opus">
                <SelectTrigger id="form-model" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="opus">claude-opus</SelectItem>
                    <SelectItem value="sonnet">claude-sonnet</SelectItem>
                    <SelectItem value="gpt5">gpt-5</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="form-task">Task</FieldLabel>
              <Textarea id="form-task" placeholder="Describe what Atlas should do" />
              <FieldDescription>Include file paths where you can.</FieldDescription>
            </Field>
          </FieldGroup>
        </FieldSet>
        <FieldSeparator>Permissions</FieldSeparator>
        <FieldSet>
          <FieldLegend variant="label">Approval mode</FieldLegend>
          <RadioGroup defaultValue="ask">
            <Field orientation="horizontal">
              <RadioGroupItem value="ask" id="mode-ask" />
              <FieldLabel htmlFor="mode-ask">Ask for every write</FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <RadioGroupItem value="edits" id="mode-edits" />
              <FieldLabel htmlFor="mode-edits">Allow edits, ask for bash</FieldLabel>
            </Field>
          </RadioGroup>
        </FieldSet>
        <Field orientation="horizontal">
          <Checkbox id="form-commit" defaultChecked />
          <FieldLabel htmlFor="form-commit">Commit after each turn</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <Button type="submit">Start session</Button>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </Field>
      </FieldGroup>
    </form>
  ),
}

export const ChoiceCards: Story = {
  render: () => (
    <RadioGroup defaultValue="cloud" className="w-96">
      <FieldLabel htmlFor="where-cloud">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle>Cloud sandbox</FieldTitle>
            <FieldDescription>
              Runs in a Vercel sandbox, survives closing your laptop.
            </FieldDescription>
          </FieldContent>
          <RadioGroupItem value="cloud" id="where-cloud" />
        </Field>
      </FieldLabel>
      <FieldLabel htmlFor="where-local">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle>This machine</FieldTitle>
            <FieldDescription>Uses your local checkout and credentials.</FieldDescription>
          </FieldContent>
          <RadioGroupItem value="local" id="where-local" />
        </Field>
      </FieldLabel>
    </RadioGroup>
  ),
}
