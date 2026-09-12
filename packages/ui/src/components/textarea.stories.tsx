import type { Meta, StoryObj } from "@storybook/react-vite";

import { Textarea } from "./textarea";

const meta = {
  title: "Forms/Textarea",
  component: Textarea,
  tags: ["autodocs"],
  args: { placeholder: "Describe the work…" },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { rows: 3 },
};

export const WithLabel: Story = {
  args: {
    label: "Instructions",
    mono: true,
    rows: 6,
    hint: "Markdown. @ mentions a file, / runs a command.",
  },
};

export const AutoGrow: Story = {
  args: {
    autoGrow: true,
    maxRows: 8,
    rows: 1,
    hint: "Grows to the draft, caps at 8 rows. Enter submits, Shift+Enter is a newline.",
  },
};

export const WithError: Story = {
  args: {
    label: "Commit message",
    defaultValue: "fix stuff",
    error: "Conventional commits: <type>(<scope>): <description>.",
  },
};

export const Disabled: Story = {
  args: {
    label: "Transcript",
    defaultValue: "Read-only while the turn runs.",
    disabled: true,
  },
};
