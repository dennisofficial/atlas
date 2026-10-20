import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "@dltech/atlas-ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@dltech/atlas-ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@dltech/atlas-ui/components/field";
import { Input } from "@dltech/atlas-ui/components/input";

const meta = {
  title: "Components/Dialog",
  component: Dialog,
} satisfies Meta<typeof Dialog>;

export default meta;

type Story = StoryObj<typeof meta>;

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
};

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
};

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
};
