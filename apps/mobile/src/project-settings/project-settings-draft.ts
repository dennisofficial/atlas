import type { Project, ProjectUpdate } from '@dltech/atlas-wire/web'

export interface IProjectDraft {
  name: string
  description: string
}

export const draftOf = (project: Project): IProjectDraft => ({
  name: project.name,
  description: project.description,
})

export const draftIsDirty = ({
  project,
  draft,
}: {
  project: Project
  draft: IProjectDraft
}): boolean => project.name !== draft.name || project.description !== draft.description

export const draftIsValid = ({ draft }: { draft: IProjectDraft }): boolean =>
  draft.name.trim().length > 0

export const updatePayloadOf = ({
  project,
  draft,
}: {
  project: Project
  draft: IProjectDraft
}): ProjectUpdate => ({
  projectId: project.id,
  name: draft.name.trim(),
  repo: project.repo,
  baseBranch: project.baseBranch,
  additionalRepos: project.additionalRepos.map(({ repo, branch }) =>
    branch === undefined ? { repo } : { repo, branch },
  ),
  description: draft.description,
  shipBehavior: project.shipBehavior,
})
