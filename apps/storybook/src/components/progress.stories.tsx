import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@dltech/atlas-ui/components/progress";

const meta = {
  title: "Components/Progress",
  component: Progress,
  argTypes: { value: { control: { type: "range", min: 0, max: 100 } } },
  args: { value: 62 },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Progress>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithLabel: Story = {
  render: (args) => (
    <Progress {...args}>
      <ProgressLabel>Indexing repository</ProgressLabel>
      <ProgressValue />
    </Progress>
  ),
};

export const Indeterminate: Story = {
  args: { value: null },
  render: (args) => (
    <Progress {...args}>
      <ProgressLabel>Booting sandbox</ProgressLabel>
    </Progress>
  ),
};
