import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@dltech/atlas-ui/components/dialog'

import { DetailsStep } from './new-project-details-step'
import {
  additionalReposOf,
  canContinueFromRepository,
  emptyDraft,
  nameErrorOf,
  nextStep,
  previousStep,
  stepPosition,
  suggestedName,
  visibleNameError,
} from './new-project-draft'
import { RepositoryStep } from './new-project-repository-step'
import { SourceStep } from './new-project-source-step'
import {
  ENewProjectStep,
  type DraftPatch,
  type EProjectSource,
  type ProjectDraft,
} from './new-project-types'
import { PROJECTS } from './projects.fixtures'

const TAKEN_NAMES = PROJECTS.map((project) => project.name)

const STEP_COPY: Record<ENewProjectStep, { title: string; description: string }> = {
  [ENewProjectStep.Source]: {
    title: 'New project',
    description: "Where should this project's code come from?",
  },
  [ENewProjectStep.Repository]: {
    title: 'Choose a repository',
    description: 'Threads in this project clone it.',
  },
  [ENewProjectStep.Details]: {
    title: 'Set up your project',
    description: 'You can change all of this later in project settings.',
  },
}

function NewProjectBody({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(ENewProjectStep.Source)
  const [draft, setDraft] = useState<ProjectDraft>(() => emptyDraft())
  const patch: DraftPatch = (changes) => setDraft((current) => ({ ...current, ...changes }))

  const copy = STEP_COPY[step]
  const position = stepPosition({ step, source: draft.source })
  const name = draft.nameTouched ? draft.name : suggestedName(draft) || draft.name
  const nameError = nameErrorOf({ name, takenNames: TAKEN_NAMES })
  const canCreate = nameError === null && additionalReposOf(draft) !== null

  const handleSelectSource = (source: EProjectSource) => {
    patch({ source })
    setStep(nextStep({ step: ENewProjectStep.Source, source }))
  }
  const handleBack = () => setStep(previousStep({ step, source: draft.source }))
  const handleContinue = () => setStep(nextStep({ step, source: draft.source }))
  const handleCreate = () => {
    if (!canCreate) return
    toast.success(`Project “${name.trim()}” created`)
    onClose()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>
      <div className="-mx-4 max-h-[min(32rem,calc(100dvh-14rem))] min-h-64 overflow-y-auto px-4 py-1">
        {step === ENewProjectStep.Source ? <SourceStep onSelect={handleSelectSource} /> : null}
        {step === ENewProjectStep.Repository ? (
          <RepositoryStep draft={draft} patch={patch} />
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
          <Button onClick={handleContinue} disabled={!canContinueFromRepository(draft)}>
            Continue
          </Button>
        ) : null}
        {step === ENewProjectStep.Details ? (
          <Button onClick={handleCreate} disabled={!canCreate}>
            Create project
          </Button>
        ) : null}
      </DialogFooter>
    </>
  )
}

export function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const handleClose = () => onOpenChange(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <NewProjectBody onClose={handleClose} />
      </DialogContent>
    </Dialog>
  )
}
