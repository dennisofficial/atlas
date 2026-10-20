import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  Bubble,
  BubbleContent,
  BubbleGroup,
  BubbleReactions,
} from "@dltech/atlas-ui/components/bubble";

const variants = [
  "default",
  "secondary",
  "muted",
  "tinted",
  "outline",
  "ghost",
  "destructive",
] as const;

const meta = {
  title: "Components/Bubble",
  component: Bubble,
  argTypes: {
    variant: { control: "select", options: variants },
    align: { control: "inline-radio", options: ["start", "end"] },
  },
  args: { variant: "secondary", align: "start" },
  decorators: [
    (Story) => (
      <div className="w-[28rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Bubble>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Bubble {...args}>
      <BubbleContent>Can you rename the session store and update its imports?</BubbleContent>
    </Bubble>
  ),
};

export const Variants: Story = {
  render: () => (
    <BubbleGroup>
      {variants.map((variant) => (
        <Bubble key={variant} variant={variant}>
          <BubbleContent>{variant}</BubbleContent>
        </Bubble>
      ))}
    </BubbleGroup>
  ),
};

export const Reply: Story = {
  render: () => (
    <BubbleGroup>
      <Bubble variant="muted">
        <BubbleContent>Renamed 3 files and updated 11 imports.</BubbleContent>
        <BubbleReactions>👍 2</BubbleReactions>
      </Bubble>
      <Bubble variant="default" align="end">
        <BubbleContent>Run the typecheck too.</BubbleContent>
      </Bubble>
    </BubbleGroup>
  ),
};
