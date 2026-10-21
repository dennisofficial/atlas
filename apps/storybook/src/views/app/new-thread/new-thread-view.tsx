import { FolderGit2Icon, FolderXIcon } from "lucide-react";

import { TooltipProvider } from "@dltech/atlas-ui/components/tooltip";

import { AppShell } from "../app-shell";
import { Composer } from "../session/composer";
import { SessionView } from "../session/session-view";
import { DEFAULT_PROJECT_ID, MODEL_LABEL, PENDING_THREAD_ID, pendingThreadOf, projectLabelOf, titleOf } from "./new-thread-data";
import { useNewThreadFlow, type NewThreadFlow } from "./new-thread-flow";
import { podChipOf, podStateOf } from "./new-thread-pod";
import { NewThreadTranscript } from "./new-thread-transcript";
import { ENewThreadOutcome, ENewThreadStage, isFailureStage, isProvisioningStage } from "./new-thread-types";
import { ProjectPicker } from "./project-picker";

export interface NewThreadViewProps {
  initialStage?: ENewThreadStage;
  initialProjectId?: string | null;
  outcome?: ENewThreadOutcome;
  autoRun?: boolean;
}

function badgeLabelOf(stage: ENewThreadStage): string | null {
  if (isProvisioningStage(stage) || stage === ENewThreadStage.Streaming) return null;
  if (stage === ENewThreadStage.Idle) return "Idle";
  if (isFailureStage(stage)) return "Failed";
  return "Not started";
}

function placeholderOf(stage: ENewThreadStage): string | undefined {
  if (isProvisioningStage(stage)) return "Atlas is starting a pod…";
  return stage === ENewThreadStage.Streaming ? "Queue a message for when Atlas is done…" : undefined;
}

function Welcome({ flow }: { flow: NewThreadFlow }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 pb-16">
      <h1 className="text-xl font-medium tracking-tight">What should Atlas work on?</h1>
      <Composer
        value={flow.draft}
        onValueChange={flow.handleDraftChange}
        onSend={flow.handleSend}
        placeholder="Describe a task for Atlas…"
        showContext={false}
        className="max-w-2xl pb-0"
      >
        <div className="ml-auto flex min-w-0">
          <ProjectPicker projectId={flow.projectId} onProjectChange={flow.handleProjectChange} />
        </div>
      </Composer>
    </div>
  );
}

export function NewThreadView({
  initialStage = ENewThreadStage.Draft,
  initialProjectId = DEFAULT_PROJECT_ID,
  outcome = ENewThreadOutcome.Success,
  autoRun = false,
}: NewThreadViewProps) {
  const flow = useNewThreadFlow({ initialStage, initialProjectId, outcome, autoRun });
  const { stage } = flow;

  if (stage === ENewThreadStage.Draft) {
    return (
      <TooltipProvider>
        <AppShell>
          <Welcome flow={flow} />
        </AppShell>
      </TooltipProvider>
    );
  }

  const pendingThread = pendingThreadOf({ prompt: flow.prompt, projectId: flow.projectId, stage });

  return (
    <SessionView
      header={{
        title: titleOf(flow.prompt),
        subtitle: {
          label: projectLabelOf(flow.projectId),
          icon: flow.projectId === null ? FolderXIcon : FolderGit2Icon,
        },
        detail: MODEL_LABEL,
        badgeLabel: badgeLabelOf(stage),
        podStatus: podChipOf(stage),
      }}
      shell={{ activeThreadId: pendingThread ? PENDING_THREAD_ID : undefined, pendingThread }}
      pod={podStateOf({ stage, projectId: flow.projectId, visibleSteps: flow.visibleSteps, onRetry: flow.handleRetry })}
      renderTranscript={({ onOpenFile }) => (
        <NewThreadTranscript
          stage={stage}
          prompt={flow.prompt}
          elapsed={flow.elapsed}
          visibleSteps={flow.visibleSteps}
          replyWords={flow.replyWords}
          onCancel={flow.handleCancel}
          onRetry={flow.handleRetry}
          onEditMessage={flow.handleEditMessage}
          onOpenFile={onOpenFile}
        />
      )}
      composer={
        <Composer
          value={flow.draft}
          onValueChange={flow.handleDraftChange}
          onSend={flow.handleSend}
          placeholder={placeholderOf(stage)}
          busy={stage === ENewThreadStage.Streaming}
          disabled={isProvisioningStage(stage)}
          queued={flow.queued}
          onRemoveQueued={flow.handleRemoveQueued}
          showContext={false}
        />
      }
    />
  );
}
