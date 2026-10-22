import { useRouter } from 'next/navigation'
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
import { Spinner } from '@dltech/atlas-ui/components/spinner'
import type { Project } from '@dltech/atlas-wire/web'

import { createProject } from '@/features/project-settings/data/project-api'

import { DetailsStep } from './new-project-details-step'
import {
  canContinueFromRepository,
  createBodyOf,
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
import { ENewProjectStep, type DraftPatch, type EProjectSource, type ProjectDraft } from './new-project-types'
import type { OwnerOption } from './project-owner'

export interface NewProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: readonly Project[]
  owners: readonly OwnerOption[]
  defaultOwnerId: string | null
}

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
    title: 'Name your project',
    description: 'You can change all of this later.',
  },
}

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

function NewProjectBody({
  projects,
  owners,
  defaultOwnerId,
  onClose,
}: Omit<NewProjectDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const router = useRouter()
  const [step, setStep] = useState(ENewProjectStep.Source)
  const [draft, setDraft] = useState<ProjectDraft>(() => emptyDraft(defaultOwnerId))
  const [submitting, setSubmitting] = useState(false)
  const patch: DraftPatch = (changes) => setDraft((current) => ({ ...current, ...changes }))

  const copy = STEP_COPY[step]
  const position = stepPosition({ step, source: draft.source })
  const name = draft.nameTouched ? draft.name : suggestedName(draft) || draft.name
  const nameError = nameErrorOf({ name, ownerId: draft.ownerId, projects })

  const handleSelectSource = (source: EProjectSource) => {
    patch({ source })
    setStep(nextStep({ step: ENewProjectStep.Source, source }))
  }
  const handleBack = () => setStep(previousStep({ step, source: draft.source }))
  const handleContinue = () => setStep(nextStep({ step, source: draft.source }))
  const handleCreate = async () => {
    if (nameError || submitting) return
    setSubmitting(true)
    try {
      const created = await createProject(createBodyOf({ draft, name }))
      toast.success('Project created')
      router.push(`/threads/new?project=${encodeURIComponent(created.id)}`)
    } catch (failure) {
      toast.error(messageOf(failure))
      setSubmitting(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>
      <div className="min-h-64">
        {step === ENewProjectStep.Source ? <SourceStep onSelect={handleSelectSource} /> : null}
        {step === ENewProjectStep.Repository ? (
          <RepositoryStep draft={draft} patch={patch} />
        ) : null}
        {step === ENewProjectStep.Details ? (
          <DetailsStep
            draft={{ ...draft, name }}
            patch={patch}
            owners={owners}
            nameError={visibleNameError({ error: nameError, touched: draft.nameTouched })}
          />
        ) : null}
      </div>
      <DialogFooter className="items-center">
        <span className="mr-auto font-mono text-xs tabular-nums text-muted-foreground">
          Step {position.current} of {position.total}
        </span>
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        {step === ENewProjectStep.Source ? null : (
          <Button variant="outline" onClick={handleBack} disabled={submitting}>
            Back
          </Button>
        )}
        {step === ENewProjectStep.Repository ? (
          <Button onClick={handleContinue} disabled={!canContinueFromRepository(draft)}>
            Continue
          </Button>
        ) : null}
        {step === ENewProjectStep.Details ? (
          <Button onClick={handleCreate} disabled={nameError !== null || submitting}>
            {submitting ? <Spinner data-icon="inline-start" /> : null}
            Create project
          </Button>
        ) : null}
      </DialogFooter>
    </>
  )
}

export function NewProjectDialog({ open, onOpenChange, ...body }: NewProjectDialogProps) {
  const handleClose = () => onOpenChange(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <NewProjectBody {...body} onClose={handleClose} />
      </DialogContent>
    </Dialog>
  )
}
