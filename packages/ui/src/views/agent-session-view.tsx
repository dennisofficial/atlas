import type { Meta, StoryObj } from "@storybook/react-vite";

import { Avatar } from "../atoms/avatar";
import { Badge } from "../atoms/badge";
import { Card } from "../atoms/card";
import { ChatBubble } from "../molecules/chat-bubble";
import { ToolCallCard } from "../molecules/tool-call-card";

function AgentSessionView() {
  return (
    <div className="flex w-[720px] flex-col gap-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar kind="agent" name="Atlas" size="sm" status="running" />
          <div className="flex flex-col">
            <span className="text-base font-medium text-foreground">ui-taxonomy</span>
            <span className="text-xs text-hint">dennis/ui-taxonomy · worktree</span>
          </div>
        </div>
        <Badge tone="primary" dot>
          running
        </Badge>
      </header>

      <Card padded={false}>
        <div className="flex flex-col gap-5 p-6">
          <ChatBubble role="user" author="Dennis" timestamp="14:02">
            Compare our packages/ui against rs-crm-app's, wire it into the web app, and set up
            Storybook.
          </ChatBubble>

          <ChatBubble role="agent" author="Atlas" timestamp="14:02">
            The web app already consumes the package, but two bugs are masking it — let me trace
            the styling pipeline.
          </ChatBubble>

          <ToolCallCard
            kind="read"
            state="settled"
            sentence="Reading globals.css and the built CSS output"
            rows={[
              { label: "apps/web/src/app/globals.css" },
              { label: ".next/static/chunks/*.css" },
              { label: "packages/ui/src/styles/theme.css" },
            ]}
          />

          <ToolCallCard
            kind="edit"
            state="settled"
            sentence="Fixing the @source path and the link-color cascade"
            rows={[
              { label: "globals.css", note: "@source depth off by one ../" },
              { label: "base.css", note: "scope a rule to a:not([class])" },
            ]}
          />

          <ToolCallCard
            kind="shell"
            state="running"
            sentence="Rebuilding the web app to verify classes generate"
            note="bun run build"
          />

          <ChatBubble role="harness">Turn complete · 2 files changed · preview ready</ChatBubble>
        </div>
      </Card>
    </div>
  );
}

const meta = {
  title: "Views/AgentSession",
  component: AgentSessionView,
  parameters: { layout: "padded" },
} satisfies Meta<typeof AgentSessionView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
