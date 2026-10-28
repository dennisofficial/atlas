import { Field, FieldError, FieldLabel } from '@dltech/atlas-ui/components/field'
import { Input } from '@dltech/atlas-ui/components/input'
import { Textarea } from '@dltech/atlas-ui/components/textarea'

import { ENameError, NAME_ERROR_MESSAGES } from './new-project-draft'
import type { DraftPatch, ProjectDraft } from './new-project-types'

export function DetailsStep({
  draft,
  patch,
  nameError,
}: {
  draft: ProjectDraft
  patch: DraftPatch
  nameError: ENameError | null
}) {
  const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) =>
    patch({ name: event.target.value, nameTouched: true })
  const handleDescriptionChange = (event: React.ChangeEvent<HTMLTextAreaElement>) =>
    patch({ description: event.target.value })

  return (
    <div className="flex flex-col gap-4">
      <Field data-invalid={nameError ? true : undefined}>
        <FieldLabel htmlFor="project-name">Name</FieldLabel>
        <Input
          id="project-name"
          value={draft.name}
          onChange={handleNameChange}
          placeholder="my-project"
          aria-invalid={nameError ? true : undefined}
          autoComplete="off"
        />
        {nameError ? <FieldError>{NAME_ERROR_MESSAGES[nameError]}</FieldError> : null}
      </Field>
      <Field>
        <FieldLabel htmlFor="project-description">
          Description <span className="font-normal text-muted-foreground">(optional)</span>
        </FieldLabel>
        <Textarea
          id="project-description"
          value={draft.description}
          onChange={handleDescriptionChange}
          placeholder="What this project is for"
          rows={2}
        />
      </Field>
    </div>
  )
}
