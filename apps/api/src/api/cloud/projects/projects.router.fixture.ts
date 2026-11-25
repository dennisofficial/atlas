import type { INestApplication, Provider } from '@nestjs/common'
import { GithubRepoReads } from '@dltech/atlas-github'
import { localCoordinator } from '@dltech/atlas-github/testing'
import { GithubRequestCoordinator } from '@dltech/atlas-github'
import { GithubService } from '@dltech/atlas-github'
import { buildSessionTrpcApp, dataOf, trpcMutation } from '../session-trpc-test-app'
import { ProjectFileMountsService } from './project-file-mounts.service'
import { ProjectResourcesRouter } from './project-resources.router'
import { ProjectResourcesService } from './project-resources.service'
import { ProjectSettingsService } from './project-settings.service'
import { ProjectsRouter } from './projects.router'
import { ProjectsService } from './projects.service'

export const PROJECT_BODY = {
  name: 'atlas',
  repo: 'dennisofficial/atlas',
  baseBranch: 'main',
  additionalRepos: [],
}

export const projectProviders = (
  githubTokens: Record<string, string> = {},
  coordinator: GithubRequestCoordinator = localCoordinator(),
): Provider[] => [
  ProjectsService,
  ProjectResourcesService,
  ProjectFileMountsService,
  GithubRepoReads,
  { provide: GithubRequestCoordinator, useValue: coordinator },
  ProjectSettingsService,
  ProjectsRouter,
  ProjectResourcesRouter,
  {
    provide: GithubService,
    useValue: { findToken: async (args: { userId: string }) => githubTokens[args.userId] },
  },
]

export const buildProjectsApp = (args: {
  githubTokens?: Record<string, string>
  coordinator?: GithubRequestCoordinator
}): Promise<INestApplication> =>
  buildSessionTrpcApp({
    providers: projectProviders(args.githubTokens, args.coordinator),
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
