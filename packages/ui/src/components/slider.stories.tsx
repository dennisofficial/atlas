import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Slider } from "./slider";

const meta = {
  title: "Forms/Slider",
  component: Slider,
  tags: ["autodocs"],
  args: {
    label: "Compaction threshold",
    value: 72,
    valueLabel: "72%",
    onChange: () => {},
  },
} satisfies Meta<typeof Slider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithTicks: Story = {
  args: { ticks: ["0%", "50%", "100%"] },
};

export const Stepped: Story = {
  args: {
    label: "Font size",
    min: 10,
    max: 20,
    step: 1,
    value: 13,
    valueLabel: "13px",
    ticks: ["10", "15", "20"],
  },
};

export const Disabled: Story = {
  args: { disabled: true, ticks: ["0%", "50%", "100%"] },
};

export const Interactive: Story = {
  render: function Render() {
    const [value, setValue] = useState(72);
    return (
      <Slider
        label="Compaction threshold"
        value={value}
        valueLabel={`${value}%`}
        ticks={["0%", "50%", "100%"]}
        onChange={(event) => setValue(Number(event.target.value))}
      />
    );
  },
};
