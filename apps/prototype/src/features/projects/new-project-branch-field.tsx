import { Field, FieldDescription, FieldLabel } from '@dltech/atlas-ui/components/field'
import { NativeSelect, NativeSelectOption } from '@dltech/atlas-ui/components/native-select'

import { NEW_PROJECT_BRANCHES, NEW_PROJECT_REPOS } from './new-project-fixtures'
import { branchChoices, defaultBranchOf } from './new-project-repos'
import type { DraftPatch, ProjectDraft } from './new-project-types'

export function BranchField({ draft, patch }: { draft: ProjectDraft; patch: DraftPatch }) {
  if (!draft.repo) return null
  const defaultBranch = defaultBranchOf({ repos: NEW_PROJECT_REPOS, repo: draft.repo })
  const branches = branchChoices({ branches: NEW_PROJECT_BRANCHES, defaultBranch })
  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) =>
    patch({ branch: event.target.value || null })
  return (
    <Field>
      <FieldLabel htmlFor="repo-branch">Branch</FieldLabel>
      <NativeSelect
        id="repo-branch"
        className="w-full"
        value={draft.branch ?? ''}
        onChange={handleChange}
      >
        <NativeSelectOption value="">
          {defaultBranch ? `Default branch (${defaultBranch})` : 'Default branch'}
        </NativeSelectOption>
        {branches.map((branch) => (
          <NativeSelectOption key={branch} value={branch}>
            {branch}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <FieldDescription>Threads start from this branch unless you pick another.</FieldDescription>
    </Field>
  )
}
