import { useState } from "react";

import { Context } from "@dltech/atlas-ui/ai/context";
import { EEffort, ModelSelector } from "@dltech/atlas-ui/ai/model-selector";
import type { PlanStep } from "@dltech/atlas-ui/ai/plan";
import { PromptInput } from "@dltech/atlas-ui/ai/prompt-input";
import { TaskDock, type QueuedMessage } from "@dltech/atlas-ui/ai/task-dock";

import { MODELS } from "../../../fixtures/agent";

export interface ComposerProps {
  steps: PlanStep[];
  queued: QueuedMessage[];
  busy: boolean;
  onRemoveQueued: (id: string) => void;
  onSend: (text: string) => void;
}

const CONTEXT_BREAKDOWN = [
  { label: "System prompt", tokens: 6_200 },
  { label: "Tools", tokens: 14_800 },
  { label: "Messages", tokens: 31_400 },
];

export function Composer({ steps, queued, busy, onRemoveQueued, onSend }: ComposerProps) {
  const [model, setModel] = useState("claude-opus");
  const [effort, setEffort] = useState(EEffort.High);
  const [draft, setDraft] = useState("");

  const handleSubmit = (text: string) => {
    onSend(text);
    setDraft("");
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-2 px-4 pb-4">
      <TaskDock steps={steps} queued={queued} onRemoveQueued={onRemoveQueued} />
      <PromptInput
        value={draft}
        onValueChange={setDraft}
        onSubmit={handleSubmit}
        busy={busy}
        placeholder={busy ? "Queue a message for when Atlas is done…" : undefined}
      >
        <ModelSelector
          models={MODELS}
          value={model}
          onValueChange={setModel}
          effort={effort}
          onEffortChange={setEffort}
        />
        <Context className="ml-auto" used={52_400} limit={200_000} breakdown={CONTEXT_BREAKDOWN} />
      </PromptInput>
    </div>
  );
}
