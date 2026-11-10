'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import type { Routine } from '@dltech/atlas-protocol'
import { Button } from '@dltech/atlas-ui/components/button'
import { Field, FieldDescription, FieldLabel } from '@dltech/atlas-ui/components/field'
import { Input } from '@dltech/atlas-ui/components/input'
import { NativeSelect, NativeSelectOption } from '@dltech/atlas-ui/components/native-select'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@dltech/atlas-ui/components/sheet'

import { useModelPicker } from '@/features/threads/data/use-model-picker'
import { fetchProjects } from '@/features/threads/data/threads-api'
import { messageOf } from '@/features/threads/data/use-send'
import { PROJECTS_KEY } from '@/lib/cloud-keys'
import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'

import { useCreateRoutine, useRemoveRoutine, useUpdateRoutine } from './data/routines-api'
import { draftOf, type RoutineDraft } from './routine-draft'
import { RoutineSchedulePreview } from './routine-schedule-preview'

const LABEL = 'flex flex-col gap-1.5 text-sm font-medium'
const CONTROL =
  'w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring'

function RoutineForm({
  routine,
  defaultProjectId,
  onDone,
}: {
  routine: Routine | undefined
  defaultProjectId: string
  onDone: () => void
}) {
  const router = useRouter()
  const projects = useCloudQuery({ key: PROJECTS_KEY, load: fetchProjects })
  const models = useModelPicker()
  const create = useCreateRoutine()
  const update = useUpdateRoutine()
  const remove = useRemoveRoutine()
  const [draft, setDraft] = useState(() => draftOf(routine, defaultProjectId))
  const [failure, setFailure] = useState<string | null>(null)
  const saving = create.isPending || update.isPending || remove.isPending

  const projectOptions = projects.state === EQueryState.Ready ? projects.data : []
  const projectId = draft.projectId === '' ? (projectOptions[0]?.id ?? '') : draft.projectId
  const patch = (next: Partial<RoutineDraft>) => setDraft((current) => ({ ...current, ...next }))

  const submit = async () => {
    setFailure(null)
    const body = {
      name: draft.name.trim(),
      prompt: draft.prompt,
      cron: draft.cron.trim(),
      timezone: draft.timezone.trim(),
      model: draft.model === '' ? null : draft.model,
    }
    try {
      if (routine === undefined) {
        const created = await create.mutateAsync({ ...body, projectId })
        onDone()
        router.push(`/routines/${encodeURIComponent(created.routineId)}`)
        return
      }
      await update.mutateAsync({ ...body, routineId: routine.routineId })
      onDone()
    } catch (error) {
      setFailure(messageOf(error))
    }
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submit()
  }

  const handleDelete = () => {
    if (routine === undefined) return
    setFailure(null)
    remove
      .mutateAsync(routine.routineId)
      .then(() => {
        onDone()
        router.push('/routines')
      })
      .catch((error: unknown) => setFailure(messageOf(error)))
  }

  const modelOptions = models.options.models.filter((option) => option.disabled !== true)

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <Field>
          <FieldLabel htmlFor="routine-name">Name</FieldLabel>
          <Input
            id="routine-name"
            value={draft.name}
            onChange={(event) => patch({ name: event.target.value })}
            required
            maxLength={120}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="routine-project">Project</FieldLabel>
          <NativeSelect
            id="routine-project"
            className="w-full"
            value={projectId}
            onChange={(event) => patch({ projectId: event.target.value })}
            disabled={routine !== undefined}
          >
            {projectOptions.map((project) => (
              <NativeSelectOption key={project.id} value={project.id}>
                {project.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>

        <div className="flex flex-col gap-1.5">
          <Field>
            <FieldLabel htmlFor="routine-cron">Schedule</FieldLabel>
            <Input
              id="routine-cron"
              className="font-mono"
              value={draft.cron}
              onChange={(event) => patch({ cron: event.target.value })}
              required
              maxLength={120}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="routine-timezone">Timezone</FieldLabel>
            <Input
              id="routine-timezone"
              className="font-mono"
              value={draft.timezone}
              onChange={(event) => patch({ timezone: event.target.value })}
              required
              maxLength={80}
            />
          </Field>
          <RoutineSchedulePreview cron={draft.cron.trim()} timezone={draft.timezone.trim()} />
        </div>

        <Field>
          <FieldLabel htmlFor="routine-model">Model</FieldLabel>
          <NativeSelect
            id="routine-model"
            className="w-full"
            value={draft.model}
            onChange={(event) => patch({ model: event.target.value })}
          >
            <NativeSelectOption value="">Account default</NativeSelectOption>
            {modelOptions.map((option) => (
              <NativeSelectOption key={option.id} value={option.id}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>

        <label className={LABEL} htmlFor="routine-prompt">
          Prompt
          <textarea
            id="routine-prompt"
            value={draft.prompt}
            onChange={(event) => patch({ prompt: event.target.value })}
            rows={7}
            required
            maxLength={20_000}
            className={CONTROL}
          />
        </label>
        <Field>
          <FieldDescription>
            The prompt is sent as the session&rsquo;s first message, unchanged. Rewrites are yours
            to make; the agent cannot edit a routine.
          </FieldDescription>
        </Field>

        {failure === null ? null : (
          <p role="alert" className="text-xs text-destructive">
            {failure}
          </p>
        )}
      </div>

      <SheetFooter className="flex-row justify-end">
        {routine === undefined ? null : (
          <Button
            type="button"
            variant="ghost"
            className="mr-auto text-destructive"
            onClick={handleDelete}
            disabled={saving}
          >
            Delete
          </Button>
        )}
        <SheetClose render={<Button type="button" variant="ghost" />}>Cancel</SheetClose>
        <Button type="submit" disabled={saving}>
          {routine === undefined ? 'Create routine' : 'Save routine'}
        </Button>
      </SheetFooter>
    </form>
  )
}

export function RoutineCreateSheet({
  open,
  onOpenChange,
  routine,
  defaultProjectId = '',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  routine?: Routine
  defaultProjectId?: string
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="data-[side=right]:sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{routine === undefined ? 'New routine' : 'Edit routine'}</SheetTitle>
          <SheetDescription>
            A saved prompt on a schedule. Each run is a fresh session, on this project.
          </SheetDescription>
        </SheetHeader>
        <RoutineForm
          key={`${routine?.routineId ?? 'new'}:${open ? 'open' : 'closed'}`}
          routine={routine}
          defaultProjectId={defaultProjectId}
          onDone={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  )
}
