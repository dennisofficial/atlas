import { useCallback } from 'react'

import type { GithubRepoSummary } from '@dltech/atlas-wire/web'
import { Field, FieldDescription, FieldLabel } from '@dltech/atlas-ui/components/field'
import { NativeSelect, NativeSelectOption } from '@dltech/atlas-ui/components/native-select'

import { useCloudQuery } from '@/lib/use-cloud-query'

import { fetchGithubBranches } from './data/github-repos-api'
import { branchChoices, defaultBranchOf } from './new-project-repos'
import type { DraftPatch, ProjectDraft } from './new-project-types'

function useBranches(repo: string) {
  const load = useCallback(() => fetchGithubBranches(repo), [repo])
  return useCloudQuery({ key: `github-branches:${repo}`, load })
}

function RepoBranchSelect({
  repo,
  repos,
  draft,
  patch,
}: {
  repo: string
  repos: readonly GithubRepoSummary[]
  draft: ProjectDraft
  patch: DraftPatch
}) {
  const query = useBranches(repo)
  const defaultBranch = defaultBranchOf({ repos, repo })
  const branches = branchChoices({ branches: query.data ?? [], defaultBranch })
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
        disabled={query.data === undefined && query.error === undefined}
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

export function BranchField(props: {
  repos: readonly GithubRepoSummary[]
  draft: ProjectDraft
  patch: DraftPatch
}) {
  const { draft } = props
  if (!draft.repo) return null
  return <RepoBranchSelect key={draft.repo} {...props} repo={draft.repo} />
}
