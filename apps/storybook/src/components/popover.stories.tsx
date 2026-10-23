import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Button } from '@dltech/atlas-ui/components/button'
import { Field, FieldGroup, FieldLabel } from '@dltech/atlas-ui/components/field'
import { Input } from '@dltech/atlas-ui/components/input'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@dltech/atlas-ui/components/popover'

const meta = {
  title: 'Components/Popover',
  component: Popover,
} satisfies Meta<typeof Popover>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" />}>Context budget</PopoverTrigger>
      <PopoverContent className="w-80">
        <PopoverHeader>
          <PopoverTitle>Context budget</PopoverTitle>
          <PopoverDescription>
            Limit how much of the window tool results can use.
          </PopoverDescription>
        </PopoverHeader>
        <FieldGroup>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="budget-total">Total</FieldLabel>
            <Input id="budget-total" defaultValue="200k" className="h-8" />
          </Field>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="budget-tools">Tools</FieldLabel>
            <Input id="budget-tools" defaultValue="60k" className="h-8" />
          </Field>
        </FieldGroup>
      </PopoverContent>
    </Popover>
  ),
}
