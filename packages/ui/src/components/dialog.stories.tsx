import type { Meta, StoryObj } from '@storybook/react'

import { Button } from '#components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#components/dialog'
import { Field, FieldGroup, FieldLabel } from '#components/field'
import { Input } from '#components/input'
import { Textarea } from '#components/textarea'

const LONG_TOKEN = 'x'.repeat(100)

const meta = {
  title: 'Components/Dialog',
  component: Dialog,
} satisfies Meta<typeof Dialog>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>Rename session</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename session</DialogTitle>
          <DialogDescription>Give this session a name you will recognise later.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="session-name">Name</FieldLabel>
            <Input id="session-name" defaultValue="fix flaky ws reconnect" />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

export const DefaultOpen: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogTrigger render={<Button variant="outline" />}>Rename session</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename session</DialogTitle>
          <DialogDescription>Give this session a name you will recognise later.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="session-name-open">Name</FieldLabel>
            <Input id="session-name-open" defaultValue="fix flaky ws reconnect" />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

export const NoCloseButton: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>Open</DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Approve tool call</DialogTitle>
          <DialogDescription>
            bash wants to run <span className="font-mono">bun run build</span>.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Deny</DialogClose>
          <DialogClose render={<Button />}>Approve</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

export const LongValue: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogTrigger render={<Button variant="outline" />}>Add secret</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a secret</DialogTitle>
          <DialogDescription>
            Available to every thread in this project as an environment variable.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="secret-name">Name</FieldLabel>
          <Input
            id="secret-name"
            className="font-mono"
            defaultValue="STRIPE_SECRET_KEY_FOR_PRODUCTION_BILLING_WEBHOOK_SIGNING"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="secret-value">Value</FieldLabel>
          <Textarea
            id="secret-value"
            className="min-h-20 font-mono text-xs md:text-xs"
            defaultValue={LONG_TOKEN}
          />
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button>Add secret</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}
