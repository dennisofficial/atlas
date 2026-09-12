import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { ModelPicker } from "./model-picker";
import type { PickableModel } from "./model-picker";

const MODELS: PickableModel[] = [
  {
    id: "sonnet-4-6",
    label: "sonnet-4-6",
    provider: "anthropic",
    context: "200k",
    effort: "high",
    rate: "$3/$15",
  },
  {
    id: "gpt-5-codex",
    label: "gpt-5-codex",
    provider: "openai",
    context: "400k",
    rate: "$1.25/$10",
  },
  {
    id: "opus-4-1",
    label: "opus-4-1",
    provider: "anthropic",
    context: "200k",
    rate: "$15/$75",
    unavailable: true,
  },
];

const meta = {
  title: "Agent/ModelPicker",
  component: ModelPicker,
  tags: ["autodocs"],
  args: {
    models: MODELS,
    value: "sonnet-4-6",
  },
} satisfies Meta<typeof ModelPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {
  render: function Render(args) {
    const [value, setValue] = useState(args.value ?? "sonnet-4-6");
    return (
      <div className="pt-56">
        <ModelPicker
          {...args}
          value={value}
          onChange={(model) => setValue(model.id)}
        />
      </div>
    );
  },
};

export const Open: Story = {
  args: { open: true },
};

export const OpenWithoutSpend: Story = {
  args: { open: true, showSpend: false },
};
