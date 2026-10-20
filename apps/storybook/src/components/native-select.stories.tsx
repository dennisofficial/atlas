import type { Meta, StoryObj } from "@storybook/react-vite";

import { Field, FieldLabel } from "@dltech/atlas-ui/components/field";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@dltech/atlas-ui/components/native-select";

const meta = {
  title: "Components/Native Select",
  component: NativeSelect,
  argTypes: { size: { control: "inline-radio", options: ["default", "sm"] } },
  args: { size: "default" },
} satisfies Meta<typeof NativeSelect>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Field className="w-64">
      <FieldLabel htmlFor="native-model">Model</FieldLabel>
      <NativeSelect id="native-model" {...args}>
        <NativeSelectOption value="">Select a model</NativeSelectOption>
        <NativeSelectOption value="opus">claude-opus</NativeSelectOption>
        <NativeSelectOption value="sonnet">claude-sonnet</NativeSelectOption>
        <NativeSelectOption value="gpt5">gpt-5</NativeSelectOption>
      </NativeSelect>
    </Field>
  ),
};

export const Grouped: Story = {
  render: (args) => (
    <NativeSelect aria-label="Model" {...args}>
      <NativeSelectOptGroup label="Anthropic">
        <NativeSelectOption value="opus">claude-opus</NativeSelectOption>
        <NativeSelectOption value="sonnet">claude-sonnet</NativeSelectOption>
      </NativeSelectOptGroup>
      <NativeSelectOptGroup label="OpenAI">
        <NativeSelectOption value="gpt5">gpt-5</NativeSelectOption>
      </NativeSelectOptGroup>
    </NativeSelect>
  ),
};

export const Disabled: Story = {
  render: (args) => (
    <NativeSelect aria-label="Model" disabled {...args}>
      <NativeSelectOption>claude-opus</NativeSelectOption>
    </NativeSelect>
  ),
};

export const Invalid: Story = {
  render: (args) => (
    <NativeSelect aria-label="Model" aria-invalid {...args}>
      <NativeSelectOption value="">Select a model</NativeSelectOption>
    </NativeSelect>
  ),
};
