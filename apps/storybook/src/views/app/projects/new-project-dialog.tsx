import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@dltech/atlas-ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@dltech/atlas-ui/components/dialog";

import { ConnectGithub } from "./new-project-connect";
import { DetailsStep } from "./new-project-details-step";
import {
  canContinueFromRepository,
  emptyDraft,
  nameErrorOf,
  nextStep,
  previousStep,
  projectFromDraft,
  stepPosition,
  suggestedName,
  visibleNameError,
} from "./new-project-draft";
import { RepositoryStep } from "./new-project-repository-step";
import { SourceStep } from "./new-project-source-step";
import {
  ENewProjectStep,
  EProjectSource,
  type DraftPatch,
  type NewProjectSeed,
  type ProjectDraft,
} from "./new-project-types";
import type { ProjectSummary } from "./projects.fixtures";

export interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectSummary[];
  defaultOwnerId: string | null;
  seed?: NewProjectSeed;
  onCreate: (project: ProjectSummary) => void;
}

const STEP_COPY: Record<ENewProjectStep, { title: string; description: string }> = {
  [ENewProjectStep.Source]: { title: "New project", description: "Where should this project's code come from?" },
  [ENewProjectStep.Repository]: { title: "Choose a repository", description: "Threads in this project clone it." },
  [ENewProjectStep.Details]: { title: "Name your project", description: "You can change all of this later." },
};

function copyOf({ step, source }: { step: ENewProjectStep; source: EProjectSource }) {
  if (step === ENewProjectStep.Repository && source === EProjectSource.NewRepo) {
    return { title: "Create a repository", description: "Atlas creates it empty on GitHub, then clones it into threads." };
  }
  return STEP_COPY[step];
}

function NewProjectBody({
  projects,
  defaultOwnerId,
  seed,
  onCreate,
  onClose,
}: Omit<NewProjectDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const [step, setStep] = useState(seed?.step ?? ENewProjectStep.Source);
  const [draft, setDraft] = useState<ProjectDraft>({ ...emptyDraft(defaultOwnerId), ...seed?.draft });
  const [connected, setConnected] = useState(seed?.githubConnected ?? true);
  const patch: DraftPatch = (changes) => setDraft((current) => ({ ...current, ...changes }));

  const copy = copyOf({ step, source: draft.source });
  const position = stepPosition({ step, source: draft.source });
  const name = draft.nameTouched ? draft.name : suggestedName(draft) || draft.name;
  const nameError = nameErrorOf({ name, ownerId: draft.ownerId, projects });
  const needsConnection = step === ENewProjectStep.Repository && !connected;

  const handleSelectSource = (source: EProjectSource) => {
    patch({ source });
    setStep(nextStep({ step: ENewProjectStep.Source, source }));
  };
  const handleBack = () => setStep(previousStep({ step, source: draft.source }));
  const handleContinue = () => setStep(nextStep({ step, source: draft.source }));
  const handleConnect = () => {
    setConnected(true);
    toast.success("GitHub connected");
  };
  const handleCreate = () => {
    if (nameError) return;
    onCreate(projectFromDraft({ draft, name }));
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>
      <div className="min-h-64">
        {step === ENewProjectStep.Source ? <SourceStep onSelect={handleSelectSource} /> : null}
        {needsConnection ? <ConnectGithub onConnect={handleConnect} /> : null}
        {step === ENewProjectStep.Repository && connected ? (
          <RepositoryStep draft={draft} patch={patch} pickerOpen={seed?.pickerOpen ?? false} />
        ) : null}
        {step === ENewProjectStep.Details ? (
          <DetailsStep
            draft={{ ...draft, name }}
            patch={patch}
            nameError={visibleNameError({ error: nameError, touched: draft.nameTouched })}
          />
        ) : null}
      </div>
      <DialogFooter className="items-center">
        <span className="mr-auto font-mono text-xs tabular-nums text-muted-foreground">
          Step {position.current} of {position.total}
        </span>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {step === ENewProjectStep.Source ? null : (
          <Button variant="outline" onClick={handleBack}>
            Back
          </Button>
        )}
        {step === ENewProjectStep.Repository ? (
          <Button onClick={handleContinue} disabled={!canContinueFromRepository({ draft, connected })}>
            Continue
          </Button>
        ) : null}
        {step === ENewProjectStep.Details ? (
          <Button onClick={handleCreate} disabled={nameError !== null}>
            Create project
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
}

export function NewProjectDialog({ open, onOpenChange, ...body }: NewProjectDialogProps) {
  const handleClose = () => onOpenChange(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <NewProjectBody {...body} onClose={handleClose} />
      </DialogContent>
    </Dialog>
  );
}
