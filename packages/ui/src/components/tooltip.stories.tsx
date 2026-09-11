import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button";
import { Tooltip } from "./tooltip";

const meta = {
  title: "Overlays/Tooltip",
  component: Tooltip,
  tags: ["autodocs"],
  argTypes: {
    side: { control: "select", options: ["top", "bottom", "left", "right"] },
  },
  args: {
    content: "Rewind this turn",
    kbd: "⌘Z",
    children: (
      <Button variant="ghost" size="sm">
        Rewind
      </Button>
    ),
  },
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Bottom: Story = {
  args: { side: "bottom" },
};

export const NoShortcut: Story = {
  render: (args) => {
    const { kbd: _kbd, ...rest } = args;
    return <Tooltip {...rest} content="New session" />;
  },
};
