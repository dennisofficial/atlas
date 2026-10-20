import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "@dltech/atlas-ui/components/button";
import { DirectionProvider } from "@dltech/atlas-ui/components/direction";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@dltech/atlas-ui/components/item";

const meta = {
  title: "Components/Direction",
  component: DirectionProvider,
  argTypes: { direction: { control: "inline-radio", options: ["ltr", "rtl"] } },
  args: { direction: "rtl" },
} satisfies Meta<typeof DirectionProvider>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Rtl: Story = {
  render: (args) => (
    <DirectionProvider {...args}>
      <div dir={args.direction} className="w-96">
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>Session paused</ItemTitle>
            <ItemDescription>Waiting for approval to run bash.</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button size="sm">Approve</Button>
          </ItemActions>
        </Item>
      </div>
    </DirectionProvider>
  ),
};

export const Ltr: Story = { args: { direction: "ltr" }, render: Rtl.render };
