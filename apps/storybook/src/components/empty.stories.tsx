import type { Meta, StoryObj } from "@storybook/react-vite";
import { SquareTerminalIcon } from "lucide-react";

import { Button } from "@dltech/atlas-ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@dltech/atlas-ui/components/empty";

const meta = {
  title: "Components/Empty",
  component: Empty,
} satisfies Meta<typeof Empty>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Empty className="w-[28rem] border border-dashed border-border" {...args}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SquareTerminalIcon />
        </EmptyMedia>
        <EmptyTitle>No sessions yet</EmptyTitle>
        <EmptyDescription>
          Start a session to let Atlas work on a branch. It shows up here with its transcript.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button>New session</Button>
      </EmptyContent>
    </Empty>
  ),
};

export const NoMedia: Story = {
  render: (args) => (
    <Empty className="w-[28rem]" {...args}>
      <EmptyHeader>
        <EmptyTitle>No results for “websocket”</EmptyTitle>
        <EmptyDescription>Try a different term or clear the filters.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline">Clear filters</Button>
      </EmptyContent>
    </Empty>
  ),
};
