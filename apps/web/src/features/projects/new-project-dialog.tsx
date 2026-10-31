import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
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

import { PROJECTS_KEY, SHELL_THREADS_KEY } from '@/lib/cloud-keys'
import { useInvalidateCloud } from '@/lib/use-invalidate-cloud'
import { createProject } from '@/features/project-settings/data/project-api'
import { putSecret } from '@/features/settings/data/shared/resource-api'

import { secretsErrorOf } from './new-project-secrets'
import { submitProject, type SubmissionProgress } from './new-project-submit'

import { DetailsStep } from './new-project-details-step'
import {
  additionalReposOf,
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
import {
  ENewProjectStep,
  type DraftPatch,
  type EProjectSource,
  type ProjectDraft,
} from './new-project-types'

export interface NewProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: readonly Project[]
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
    title: 'Set up your project',
    description: 'You can change all of this later in project settings.',
  },
}

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

function NewProjectBody({
  projects,
  onClose,
  onDismissibleChange,
}: Omit<NewProjectDialogProps, 'open' | 'onOpenChange'> & {
  onClose: () => void
  onDismissibleChange: (value: boolean) => void
}) {
  const router = useRouter()
  const invalidateCloud = useInvalidateCloud()
  const [step, setStep] = useState(ENewProjectStep.Source)
  const [draft, setDraft] = useState<ProjectDraft>(() => emptyDraft())
  const [submitting, setSubmitting] = useState(false)
  const progress = useRef<SubmissionProgress>({ projectId: null, remaining: [] })
  const inFlight = useRef(false)
  const [saveError, setSaveError] = useState(false)
  const patch: DraftPatch = (changes) => setDraft((current) => ({ ...current, ...changes }))

  const copy = STEP_COPY[step]
  const position = stepPosition({ step, source: draft.source })
  const name = draft.nameTouched ? draft.name : suggestedName(draft) || draft.name
  const nameError = nameErrorOf({ name, projects })
  const canCreate =
    !submitting &&
    (progress.current.projectId !== null ||
      (nameError === null &&
        additionalReposOf(draft) !== null &&
        secretsErrorOf(draft.secrets) === null))

  const handleSelectSource = (source: EProjectSource) => {
    patch({ source })
    setStep(nextStep({ step: ENewProjectStep.Source, source }))
  }
  const handleBack = () => setStep(previousStep({ step, source: draft.source }))
  const handleContinue = () => setStep(nextStep({ step, source: draft.source }))
  const handleCreate = async () => {
    if (!canCreate || inFlight.current) return
    inFlight.current = true
    setSubmitting(true)
    onDismissibleChange(false)
    try {
      if (progress.current.projectId === null) progress.current.remaining = draft.secrets
      await submitProject({
        body: createBodyOf({ draft, name }),
        progress: progress.current,
        createProject,
        putSecret,
      })
      await invalidateCloud([PROJECTS_KEY, SHELL_THREADS_KEY])
      toast.success('Project created')
      onClose()
      router.push(`/threads/new?project=${encodeURIComponent(progress.current.projectId ?? '')}`)
    } catch (failure) {
      if (progress.current.projectId !== null) {
        setSaveError(true)
        toast.error('Project created, but some values were not saved. Retry saving values below.')
      } else {
        onDismissibleChange(true)
        toast.error(messageOf(failure))
      }
      inFlight.current = false
      setSubmitting(false)
    }
  }

  const handleCancel = () => {
    const projectId = progress.current.projectId
    if (projectId !== null) {
      toast.error(
        'Project already created. Add the remaining values in Secrets & Env Vars settings.',
      )
      router.push(`/projects/${encodeURIComponent(projectId)}/settings/secrets`)
    }
    onClose()
  }

  return (
    <>
      <DialogHeader className="shrink-0">
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>
      <div className="-mx-4 min-h-0 overflow-y-auto px-4 py-1">
        {saveError ? (
          <p role="alert" className="text-sm text-destructive">
            Project created. Unsaved values:{' '}
            {progress.current.remaining.map((pair) => pair.name).join(', ') || 'none'}. Retry to
            finish without creating another project.
          </p>
        ) : null}
        <fieldset
          disabled={submitting || progress.current.projectId !== null}
          className="min-w-0 border-0 p-0"
        >
          <div>
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
        </fieldset>
      </div>
      <DialogFooter className="grid shrink-0 grid-cols-[1fr_auto] items-center sm:grid-cols-[1fr_auto_auto]">
        <span className="mr-auto font-mono text-xs tabular-nums text-muted-foreground">
          Step {position.current} of {position.total}
        </span>
        <Button variant="ghost" onClick={handleCancel} disabled={submitting}>
          {progress.current.projectId === null ? 'Cancel' : 'Open secrets settings'}
        </Button>
        {step === ENewProjectStep.Source ? null : (
          <div className="col-span-2 flex justify-end gap-2 sm:col-span-1">
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={submitting || progress.current.projectId !== null}
            >
              Back
            </Button>
            {step === ENewProjectStep.Repository ? (
              <Button onClick={handleContinue} disabled={!canContinueFromRepository(draft)}>
                Continue
              </Button>
            ) : null}
            {step === ENewProjectStep.Details ? (
              <Button onClick={handleCreate} disabled={!canCreate}>
                {submitting ? <Spinner data-icon="inline-start" /> : null}
                {progress.current.projectId === null ? 'Create project' : 'Retry saving values'}
              </Button>
            ) : null}
          </div>
        )}
      </DialogFooter>
    </>
  )
}

export function NewProjectDialog({ open, onOpenChange, ...body }: NewProjectDialogProps) {
  const [dismissible, setDismissible] = useState(true)
  const handleClose = () => {
    setDismissible(true)
    onOpenChange(false)
  }
  const handleOpenChange = (next: boolean) => {
    if (next || dismissible) onOpenChange(next)
  }
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-lg">
        <NewProjectBody {...body} onClose={handleClose} onDismissibleChange={setDismissible} />
      </DialogContent>
    </Dialog>
  )
}
