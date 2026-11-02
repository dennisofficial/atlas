import type { ReactNode } from 'react'

import {
  PROJECT_LIST_CLASS,
  ProjectListSkeleton,
  RepositoryStepSkeleton,
} from './project-skeletons'
import type { GithubRepoSummary } from '@dltech/atlas-wire/web'

import { ProjectRow } from './project-row'
import { RecentTiles, RepoPicker } from './new-project-repository-step'
import { EProjectSource, type ProjectDraft } from './new-project-types'
import { ProjectOverviewSkeleton } from '../project-settings/project-skeletons'

function Pair({ loading, loaded }: { loading: ReactNode; loaded: ReactNode }) {
  return (
    <div className="grid grid-cols-2 items-start gap-12 bg-background p-10">
      <div className="flex flex-col gap-4">{loading}</div>
      <div className="flex flex-col gap-4">{loaded}</div>
    </div>
  )
}

const project = (id: string, name: string, repo: string | null) => ({
  id,
  name,
  repo,
  baseBranch: null,
  additionalRepos: [],
  description: '',
  shipBehavior: 'open-pull-request' as never,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
})

const meta = {
  title: 'App/Project Skeletons',
  parameters: { layout: 'fullscreen', nextjs: { appDirectory: true } },
}

export default meta

export const ProjectList = {
  render: () => (
    <Pair
      loading={<ProjectListSkeleton />}
      loaded={
        <ul className={PROJECT_LIST_CLASS}>
          <ProjectRow project={project('1', 'atlas', 'dennisofficial/atlas')} />
          <ProjectRow project={project('2', 'docs', 'dennisofficial/docs')} />
          <ProjectRow project={project('3', 'scratch', null)} />
        </ul>
      }
    />
  ),
}

const draft: ProjectDraft = {
  source: EProjectSource.Existing,
  repo: null,
  repoQuery: '',
  branch: null,
  name: '',
  nameTouched: false,
  description: '',
  additionalRepos: [],
  secrets: [],
}

const repos: GithubRepoSummary[] = ['atlas', 'docs', 'scratch', 'website'].map((name) => ({
  fullName: `dennisofficial/${name}`,
  isPrivate: name === 'scratch',
  pushedAt: '2026-11-01T00:00:00Z',
  defaultBranch: 'main',
}))

const noop = () => {}

export const RepositoryStep = {
  render: () => (
    <Pair
      loading={<RepositoryStepSkeleton />}
      loaded={
        <div className="flex flex-col gap-4">
          <RecentTiles repos={repos} draft={draft} patch={noop} />
          <RepoPicker repos={repos} draft={draft} patch={noop} onRefresh={noop} />
        </div>
      }
    />
  ),
}

export const ProjectSettingsOverview = {
  render: () => (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 bg-background p-10">
      <ProjectOverviewSkeleton />
    </div>
  ),
}
