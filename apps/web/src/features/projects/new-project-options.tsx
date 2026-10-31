'use client'

import {
  FieldDescription,
  FieldError,
  FieldLegend,
  FieldSet,
} from '@dltech/atlas-ui/components/field'

import { AdditionalRepositories } from '@/features/project-settings/overview-repositories'

import { additionalReposOf, BAD_ADDITIONAL_REPOS_MESSAGE, repoOf } from './new-project-draft'
import type { DraftPatch, ProjectDraft } from './new-project-types'

export function RepositoryOptions({ draft, patch }: { draft: ProjectDraft; patch: DraftPatch }) {
  const mainRepository = repoOf(draft)
  if (mainRepository === null) return null
  const invalid = additionalReposOf(draft) === null
  const handleReposChange = (next: readonly string[]) => patch({ additionalRepos: next })
  return (
    <FieldSet data-invalid={invalid ? true : undefined}>
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
  )
}
