import type { Meta, StoryObj } from "@storybook/react-vite";
import { FileIcon, GitBranchIcon, SettingsIcon, SquareTerminalIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@dltech/atlas-ui/components/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@dltech/atlas-ui/components/command";

const meta = {
  title: "Components/Command",
  component: Command,
} satisfies Meta<typeof Command>;

export default meta;

type Story = StoryObj<typeof meta>;

function Palette() {
  return (
    <>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Sessions">
          <CommandItem>
            <SquareTerminalIcon />
            New session
            <CommandShortcut>⌘N</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <GitBranchIcon />
            Switch branch
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Workspace">
          <CommandItem>
            <FileIcon />
            Open file
            <CommandShortcut>⌘P</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <SettingsIcon />
            Settings
            <CommandShortcut>⌘,</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </>
  );
}

export const Default: Story = {
  render: () => (
    <Command className="w-96 rounded-lg border border-border">
      <Palette />
    </Command>
  ),
};

function DialogExample() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Open command palette
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <Command>
          <Palette />
        </Command>
      </CommandDialog>
    </>
  );
}

export const InDialog: Story = { render: () => <DialogExample /> };
