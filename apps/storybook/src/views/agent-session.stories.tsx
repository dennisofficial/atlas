import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlusIcon } from "lucide-react";

import { Chat, ChatItem } from "@dltech/atlas-ui/ai/chat";
import { Confirmation, EConfirmationState } from "@dltech/atlas-ui/ai/confirmation";
import { Context } from "@dltech/atlas-ui/ai/context";
import { DiffViewer } from "@dltech/atlas-ui/ai/diff-viewer";
import { AgentMessage, UserMessage } from "@dltech/atlas-ui/ai/message";
import { EEffort, ModelSelector } from "@dltech/atlas-ui/ai/model-selector";
import { Plan } from "@dltech/atlas-ui/ai/plan";
import { PromptInput } from "@dltech/atlas-ui/ai/prompt-input";
import { Reasoning } from "@dltech/atlas-ui/ai/reasoning";
import { Suggestions } from "@dltech/atlas-ui/ai/suggestion";
import { EToolKind, EToolState, Tool } from "@dltech/atlas-ui/ai/tool";
import { Badge } from "@dltech/atlas-ui/components/badge";
import { Button } from "@dltech/atlas-ui/components/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@dltech/atlas-ui/components/sidebar";
import { Trace } from "@dltech/atlas-ui/components/trace";

import {
  DIFF_LINES,
  GIT_STATUS_OUTPUT,
  MODELS,
  PLAN_STEPS,
  REASONING_TEXT,
  SUGGESTIONS,
  THREADS,
  TYPECHECK_OUTPUT,
} from "../fixtures/agent";

function ThreadsSidebar({ active }: { active: string }) {
  return (
    <Sidebar>
      <SidebarHeader className="flex-row items-center justify-between">
        <span className="px-2 text-sm font-semibold">Atlas</span>
        <Button size="icon-sm" variant="ghost" aria-label="New thread">
          <PlusIcon />
        </Button>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Threads</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {THREADS.map((thread) => (
                <SidebarMenuItem key={thread.id}>
                  <SidebarMenuButton
                    isActive={thread.id === active}
                    className="h-auto flex-col items-start gap-0 py-1.5"
                  >
                    <span className="w-full truncate">{thread.title}</span>
                    <span className="text-xs text-sidebar-foreground/60">{thread.meta}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

function Transcript({ approval, onApprove, onDeny }: TranscriptProps) {
  return (
    <>
      <ChatItem id="u1" anchor>
        <UserMessage author="Dennis" timestamp="14:02">
          Rebase packages/ui on shadcn base-nova, keep our colors, and fix the diff viewer.
        </UserMessage>
      </ChatItem>
      <ChatItem id="a1">
        <div className="flex flex-col gap-3">
          <Reasoning text={REASONING_TEXT} duration="9s" />
          <AgentMessage author="Atlas" timestamp="14:02">
            The theme is generated from src/tokens, so I will change the tokens and regenerate. Here is the plan.
          </AgentMessage>
          <Plan title="Plan: rebase ui on shadcn" steps={PLAN_STEPS} />
          <Trace>
            <Tool label="git status --short" output={GIT_STATUS_OUTPUT} elapsed="0.2s" />
            <Tool kind={EToolKind.Read} label="packages/ui/src/ai/diff-viewer.tsx" output="148 lines" />
            <Tool
              kind={EToolKind.Edit}
              label="packages/ui/src/tokens/semantic.ts"
              elapsed="0.4s"
              defaultOpen
            >
              <DiffViewer
                path="packages/ui/src/tokens/semantic.ts"
                added={4}
                removed={2}
                hunk="@@ -12,7 +12,21 @@"
                lines={DIFF_LINES}
              />
            </Tool>
            <Tool
              label="bun run typecheck"
              state={EToolState.Error}
              errorText={TYPECHECK_OUTPUT}
              elapsed="4.1s"
            />
            <Tool label="bun run generate" state={EToolState.Running} />
          </Trace>
        </div>
      </ChatItem>
      <ChatItem id="a2">
        <div className="flex flex-col gap-3">
          <AgentMessage author="Atlas" timestamp="14:04">
            Typecheck failed on the new tool pattern. Before I clean the generated output, I need your go-ahead.
          </AgentMessage>
          <Confirmation
            title="Run rm -rf node_modules?"
            description="Reinstalling takes about a minute."
            evidence={["matched rule: recursive delete"]}
            state={approval}
            onApprove={onApprove}
            onDeny={onDeny}
          />
        </div>
      </ChatItem>
    </>
  );
}

interface TranscriptProps {
  approval: EConfirmationState;
  onApprove: () => void;
  onDeny: () => void;
}

function AgentSession() {
  const [approval, setApproval] = useState(EConfirmationState.Pending);
  const [model, setModel] = useState("claude-sonnet");
  const [effort, setEffort] = useState(EEffort.Medium);
  const [draft, setDraft] = useState("");

  const handleApprove = () => setApproval(EConfirmationState.Approved);
  const handleDeny = () => setApproval(EConfirmationState.Denied);

  return (
    <SidebarProvider className="h-svh">
      <ThreadsSidebar active="t1" />
      <SidebarInset className="h-svh min-h-0">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
          <SidebarTrigger />
          <span className="truncate text-sm font-medium">Rebase ui on shadcn base-nova</span>
          <span className="truncate font-mono text-xs text-muted-foreground">dennis/shadcn-ui-storybook</span>
          <Badge variant="secondary" className="ml-auto">
            running
          </Badge>
        </header>
        <Chat className="min-h-0 flex-1">
          <Transcript approval={approval} onApprove={handleApprove} onDeny={handleDeny} />
        </Chat>
        <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-3 px-4 pb-4">
          <Suggestions suggestions={SUGGESTIONS} onSelect={setDraft} />
          <PromptInput value={draft} onValueChange={setDraft} onSubmit={() => setDraft("")}>
            <ModelSelector
              models={MODELS}
              value={model}
              onValueChange={setModel}
              effort={effort}
              onEffortChange={setEffort}
            />
            <Context
              className="ml-auto"
              used={52_400}
              limit={200_000}
              breakdown={[
                { label: "System prompt", tokens: 6_200 },
                { label: "Tools", tokens: 14_800 },
                { label: "Messages", tokens: 31_400 },
              ]}
            />
          </PromptInput>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

const meta = {
  title: "Views/Agent Session",
  component: AgentSession,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AgentSession>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
