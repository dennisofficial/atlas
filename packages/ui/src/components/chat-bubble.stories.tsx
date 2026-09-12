import type { Meta, StoryObj } from "@storybook/react-vite";

import { ChatBubble } from "./chat-bubble";

const meta = {
  title: "Agent/ChatBubble",
  component: ChatBubble,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="flex w-[520px] flex-col gap-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChatBubble>;

export default meta;
type Story = StoryObj<typeof meta>;

export const User: Story = {
  args: {
    role: "user",
    takeBack: true,
    attachments: [
      { kind: "file", label: "palette.ts" },
      { kind: "skill", label: "review" },
    ],
    children: "Port the TUI palette to CSS variables.",
  },
};

export const Agent: Story = {
  args: {
    role: "agent",
    author: "claude-opus-4-1",
    timestamp: "14:02",
    children:
      "The palette lives in apps/tui/src/ui/palette.ts. I'll map each entry to a CSS variable on :root and keep the light theme behind [data-theme].",
  },
};

export const AgentStreaming: Story = {
  args: {
    role: "agent",
    streaming: true,
    children: "Reading the shipped palette and the legacy web tokens…",
  },
};

export const Harness: Story = {
  args: {
    role: "harness",
    children:
      "Compacted 42 turns into a summary. Rewind still reaches all of them.",
  },
};

export const Conversation: Story = {
  render: () => (
    <>
      <ChatBubble
        role="user"
        attachments={[{ kind: "file", label: "palette.ts" }]}
      >
        Port the TUI palette to CSS variables.
      </ChatBubble>
      <ChatBubble role="agent" streaming>
        Reading the shipped palette and the legacy web tokens…
      </ChatBubble>
      <ChatBubble role="harness">
        Compacted 42 turns into a summary. Rewind still reaches all of them.
      </ChatBubble>
    </>
  ),
};
