import type { Meta, StoryObj } from "@storybook/react-vite";

import { Avatar, AvatarFallback } from "@dltech/atlas-ui/components/avatar";
import { Button } from "@dltech/atlas-ui/components/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@dltech/atlas-ui/components/hover-card";

const meta = {
  title: "Components/Hover Card",
  component: HoverCard,
} satisfies Meta<typeof HoverCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <HoverCard {...args}>
      <HoverCardTrigger render={<Button variant="link" />}>@atlas</HoverCardTrigger>
      <HoverCardContent className="w-72">
        <div className="flex gap-3">
          <Avatar>
            <AvatarFallback>AT</AvatarFallback>
          </Avatar>
          <div className="flex flex-col gap-1">
            <h4 className="text-sm font-semibold">Atlas</h4>
            <p className="text-sm text-muted-foreground">
              A coding-agent harness that owns its loop. 14 active sessions.
            </p>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  ),
};
