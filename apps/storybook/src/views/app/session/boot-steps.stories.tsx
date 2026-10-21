import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Chat, ChatItem } from "@dltech/atlas-ui/ai/chat";
import { UserMessage } from "@dltech/atlas-ui/ai/message";

import { EBootOutcome, useBootSimulation, type BootView } from "./boot-steps/boot-simulation";
import { LogTailVariant, ProgressCardVariant, ToolGroupVariant } from "./boot-steps/boot-variants";

const VARIANTS = [
  { key: "A", name: "Tool group", render: (view: BootView) => <ToolGroupVariant view={view} /> },
  { key: "B", name: "Progress card", render: (view: BootView) => <ProgressCardVariant view={view} /> },
  { key: "C", name: "Log tail", render: (view: BootView) => <LogTailVariant view={view} /> },
];

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA"].includes(target.tagName);
}

function PrototypeSwitcher({ index, onChange }: { index: number; onChange: (next: number) => void }) {
  const count = VARIANTS.length;
  const handlePrev = () => onChange((index - 1 + count) % count);
  const handleNext = () => onChange((index + 1) % count);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      if (event.key === "ArrowLeft") onChange((index - 1 + count) % count);
      if (event.key === "ArrowRight") onChange((index + 1) % count);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [index, count, onChange]);

  const variant = VARIANTS[index];
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-foreground px-2 py-1 text-background shadow-lg">
      <button type="button" aria-label="Previous variant" onClick={handlePrev} className="rounded-full p-1 hover:bg-background/15">
        <ChevronLeftIcon className="size-4" />
      </button>
      <span className="px-2 text-xs font-medium tabular-nums">
        PROTOTYPE · {variant?.key} — {variant?.name}
      </span>
      <button type="button" aria-label="Next variant" onClick={handleNext} className="rounded-full p-1 hover:bg-background/15">
        <ChevronRightIcon className="size-4" />
      </button>
    </div>
  );
}

function BootStepsPrototype({ outcome, initialVariant }: { outcome: EBootOutcome; initialVariant: number }) {
  const [index, setIndex] = useState(initialVariant);
  const view = useBootSimulation(outcome);
  const variant = VARIANTS[index] ?? VARIANTS[0];

  return (
    <div className="flex h-svh flex-col bg-background">
      <Chat className="min-h-0 flex-1">
        <ChatItem id="u1" anchor>
          <UserMessage author="Dennis" timestamp="14:02">
            Add a Vercel AI Gateway row to the providers page, marked coming soon.
          </UserMessage>
        </ChatItem>
        <ChatItem id="boot">{variant?.render(view)}</ChatItem>
      </Chat>
      <PrototypeSwitcher index={index} onChange={setIndex} />
    </div>
  );
}

const meta = {
  title: "Views/App/Session/Boot steps (prototype)",
  component: BootStepsPrototype,
  parameters: { layout: "fullscreen" },
  args: { outcome: EBootOutcome.Ready, initialVariant: 0 },
} satisfies Meta<typeof BootStepsPrototype>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ToolGroup: Story = {};
export const ProgressCard: Story = { args: { initialVariant: 1 } };
export const LogTail: Story = { args: { initialVariant: 2 } };
export const CloneFails: Story = { args: { outcome: EBootOutcome.CloneFails } };
