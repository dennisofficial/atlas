import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@dltech/atlas-ui/components/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dltech/atlas-ui/components/select'

import { NewProjectAdditionalRepos } from './new-project-additional-repos'
import { additionalReposOf, BAD_ADDITIONAL_REPOS_MESSAGE, repoOf } from './new-project-draft'
import { EShipBehavior, type DraftPatch, type ProjectDraft } from './new-project-types'

const SHIP_OPTIONS = [
  {
    value: EShipBehavior.OpenPullRequest,
    label: 'Open pull request',
    description: 'Push the branch and open a PR for review.',
  },
  {
    value: EShipBehavior.Push,
    label: 'Push branch',
    description: 'Push the branch. You open the PR.',
  },
]

const isShipBehavior = (value: unknown): value is EShipBehavior =>
  Object.values(EShipBehavior).some((behavior) => behavior === value)

function ShipField({ draft, patch }: { draft: ProjectDraft; patch: DraftPatch }) {
  const handleValueChange = (next: unknown) => {
    if (isShipBehavior(next)) patch({ shipBehavior: next })
  }
  return (
    <Field>
      <FieldLabel htmlFor="new-project-ship">When a thread ships</FieldLabel>
      <Select items={SHIP_OPTIONS} value={draft.shipBehavior} onValueChange={handleValueChange}>
        <SelectTrigger id="new-project-ship" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SHIP_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>
        {SHIP_OPTIONS.find((option) => option.value === draft.shipBehavior)?.description}
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
          <NewProjectAdditionalRepos
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
