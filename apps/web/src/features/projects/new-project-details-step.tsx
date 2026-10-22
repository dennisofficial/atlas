import { Avatar, AvatarFallback } from '@dltech/atlas-ui/components/avatar'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldTitle,
} from '@dltech/atlas-ui/components/field'
import { Input } from '@dltech/atlas-ui/components/input'
import { RadioGroup, RadioGroupItem } from '@dltech/atlas-ui/components/radio-group'
import { Textarea } from '@dltech/atlas-ui/components/textarea'

import { ENameError, NAME_ERROR_MESSAGES } from './new-project-draft'
import type { DraftPatch, ProjectDraft } from './new-project-types'
import type { OwnerOption } from './project-owner'

function OwnerCards({
  owners,
  draft,
  patch,
}: {
  owners: readonly OwnerOption[]
  draft: ProjectDraft
  patch: DraftPatch
}) {
  const handleChange = (value: unknown) => {
    if (typeof value === 'string') patch({ ownerId: value })
  }
  return (
    <RadioGroup
      value={draft.ownerId}
      onValueChange={handleChange}
      className="grid-cols-2"
      aria-label="Owner"
    >
      {owners.map((owner) => (
        <FieldLabel key={owner.id} htmlFor={`owner-${owner.id}`}>
          <Field orientation="horizontal">
            <Avatar size="sm">
              <AvatarFallback>{owner.initials}</AvatarFallback>
            </Avatar>
            <FieldContent>
              <FieldTitle className="truncate">{owner.title}</FieldTitle>
              <FieldDescription>{owner.description}</FieldDescription>
            </FieldContent>
            <RadioGroupItem value={owner.id} id={`owner-${owner.id}`} />
          </Field>
        </FieldLabel>
      ))}
    </RadioGroup>
  )
}

export function DetailsStep({
  draft,
  patch,
  owners,
  nameError,
}: {
  draft: ProjectDraft
  patch: DraftPatch
  owners: readonly OwnerOption[]
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
        <FieldLabel>Owner</FieldLabel>
        <OwnerCards owners={owners} draft={draft} patch={patch} />
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
