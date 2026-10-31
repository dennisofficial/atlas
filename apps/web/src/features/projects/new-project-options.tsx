'use client'

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from '@dltech/atlas-ui/components/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dltech/atlas-ui/components/select'
import { EShipBehavior } from '@dltech/atlas-wire/web'

import { shipOptionsOf } from '@/features/project-settings/data/project-mapping'
import { AdditionalRepositories } from '@/features/project-settings/overview-repositories'

import { additionalReposOf, BAD_ADDITIONAL_REPOS_MESSAGE, repoOf } from './new-project-draft'
import type { DraftPatch, ProjectDraft } from './new-project-types'

const isShipBehavior = (value: unknown): value is EShipBehavior =>
  Object.values(EShipBehavior).some((behavior) => behavior === value)

function ShipField({ draft, patch }: { draft: ProjectDraft; patch: DraftPatch }) {
  const options = shipOptionsOf(draft.shipBehavior)
  const handleValueChange = (next: unknown) => {
    if (isShipBehavior(next)) patch({ shipBehavior: next })
  }
  return (
    <Field>
      <FieldLabel htmlFor="new-project-ship">When a thread ships</FieldLabel>
      <Select items={options} value={draft.shipBehavior} onValueChange={handleValueChange}>
        <SelectTrigger id="new-project-ship" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>
        {options.find((option) => option.value === draft.shipBehavior)?.description}
      </FieldDescription>
    </Field>
  )
}

export function RepositoryOptions({ draft, patch }: { draft: ProjectDraft; patch: DraftPatch }) {
  const mainRepository = repoOf(draft)
  if (mainRepository === null) return null
  const invalid = additionalReposOf(draft) === null
  const handleReposChange = (next: readonly string[]) => patch({ additionalRepos: next })
  return (
    <>
      <ShipField draft={draft} patch={patch} />
      <FieldSet data-invalid={invalid ? true : undefined} className="gap-2">
        <FieldLegend variant="label">
          Additional repositories{' '}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </FieldLegend>
        <FieldDescription>
          Cloned next to {mainRepository}, for threads that span repos.
        </FieldDescription>
        <div className="flex flex-col gap-2">
          <AdditionalRepositories
            mainRepository={mainRepository}
            repositories={draft.additionalRepos}
            onChange={handleReposChange}
          />
        </div>
        {invalid ? <FieldError>{BAD_ADDITIONAL_REPOS_MESSAGE}</FieldError> : null}
      </FieldSet>
    </>
  )
}
