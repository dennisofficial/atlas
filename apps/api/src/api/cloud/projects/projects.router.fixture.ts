import type { INestApplication, Provider } from '@nestjs/common'
import { GithubRepoReads } from '../github/github-repo-reads'
import { GithubService } from '../github/github.service'
import { inertSignals } from '../../platform/sessions/thread-signals.fixture'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import {
  buildSessionTrpcApp,
  dataOf,
  trpcMutation,
  type PrincipalFixture,
} from '../session-trpc-test-app'
import { ProjectFileMountsService } from './project-file-mounts.service'
import { ProjectResourcesRouter } from './project-resources.router'
import { ProjectResourcesService } from './project-resources.service'
import { ProjectSettingsService } from './project-settings.service'
import { ProjectWorkspaceRouter } from './project-workspace.router'
import { ProjectsRouter } from './projects.router'
import { ProjectsService } from './projects.service'

export const PROJECT_BODY = {
  name: 'atlas',
  repo: 'dennisofficial/atlas',
  baseBranch: 'main',
  additionalRepos: [],
}

export const projectProviders = (githubTokens: Record<string, string> = {}): Provider[] => [
  ProjectsService,
  { provide: ThreadSignalsService, useValue: inertSignals() },
  ProjectResourcesService,
  ProjectFileMountsService,
  GithubRepoReads,
  ProjectSettingsService,
  ProjectsRouter,
  ProjectResourcesRouter,
  ProjectWorkspaceRouter,
  {
    provide: GithubService,
    useValue: { findToken: async (args: { userId: string }) => githubTokens[args.userId] },
  },
]

export const buildProjectsApp = (args: {
  githubTokens?: Record<string, string>
  sandboxTokens?: Record<string, PrincipalFixture>
  podTokens?: Record<string, PrincipalFixture>
}): Promise<INestApplication> =>
  buildSessionTrpcApp({
    providers: projectProviders(args.githubTokens),
    ...(args.sandboxTokens === undefined ? {} : { sandboxTokens: args.sandboxTokens }),
    ...(args.podTokens === undefined ? {} : { podTokens: args.podTokens }),
  })

export const createProjectAs = async (args: {
  app: INestApplication
  token: string
  body?: object
}): Promise<string> => {
  const created = await trpcMutation({
    app: args.app,
    path: 'projects.create',
    token: args.token,
    input: args.body ?? PROJECT_BODY,
  }).expect(200)
  const data = dataOf(created.body)
  if (typeof data !== 'object' || data === null) throw new Error('projects.create returned no data')
  const id: unknown = Reflect.get(data, 'id')
  if (typeof id !== 'string') throw new Error('projects.create returned no id')
  return id
}
