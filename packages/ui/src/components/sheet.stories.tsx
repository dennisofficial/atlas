import type { Meta, StoryObj } from '@storybook/react'

import { Button } from '#components/button'
import { Field, FieldGroup, FieldLabel } from '#components/field'
import { Input } from '#components/input'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '#components/sheet'

const meta = {
  title: 'Components/Sheet',
  component: Sheet,
} satisfies Meta<typeof Sheet>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Sheet {...args}>
      <SheetTrigger render={<Button variant="outline" />}>Session settings</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Session settings</SheetTitle>
          <SheetDescription>Changes apply to the next turn.</SheetDescription>
        </SheetHeader>
        <FieldGroup className="px-4">
          <Field>
            <FieldLabel htmlFor="sheet-name">Name</FieldLabel>
            <Input id="sheet-name" defaultValue="fix flaky ws reconnect" />
          </Field>
          <Field>
            <FieldLabel htmlFor="sheet-branch">Branch</FieldLabel>
            <Input id="sheet-branch" defaultValue="dennis/ws-reconnect" />
          </Field>
        </FieldGroup>
        <SheetFooter>
          <Button>Save</Button>
          <SheetClose render={<Button variant="outline" />}>Cancel</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
}

export const Sides: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
        <Sheet key={side}>
          <SheetTrigger render={<Button variant="outline" />}>{side}</SheetTrigger>
          <SheetContent side={side}>
            <SheetHeader>
              <SheetTitle>Sheet from the {side}</SheetTitle>
              <SheetDescription>Slides in from the {side} edge.</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      ))}
    </div>
  ),
}
