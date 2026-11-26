import type { INestApplication } from '@nestjs/common'
import { projectProviders } from '../projects/projects.router.fixture'
import { buildSessionTrpcApp, dataOf, trpcMutation, trpcQuery } from '../session-trpc-test-app'
import { GroupInstructionsService } from './group-instructions.service'
import { GroupResourcesRouter } from './group-resources.router'
import { GroupResourcesService } from './group-resources.service'
import { GroupSettingsService } from './group-settings.service'
import { ProjectGroupsRouter } from './project-groups.router'
import { GroupsService } from './project-groups.service'

export const buildGroupResourcesApp = (): Promise<INestApplication> =>
  buildSessionTrpcApp({
    providers: [
      ...projectProviders({ 'user-a': 'gho_a' }),
      GroupsService,
      GroupResourcesRouter,
      GroupResourcesService,
      GroupSettingsService,
      GroupInstructionsService,
      ProjectGroupsRouter,
    ],
  })

export const savedId = (body: unknown): string => (dataOf(body) as { id: string }).id

export const groupResourcesApi = (app: INestApplication) => ({
  call: (args: { procedure: string; input: object; token?: string }) =>
    trpcMutation({
      app,
      path: `groupResources.${args.procedure}`,
      token: args.token ?? 'session-a',
      input: args.input,
    }),
  query: (args: { procedure: string; input: object; token?: string }) =>
    trpcQuery({
      app,
      path: `groupResources.${args.procedure}`,
      token: args.token ?? 'session-a',
      input: args.input,
    }),
  saveGroup: (args: { name: string; token?: string }) =>
    trpcMutation({
      app,
      path: 'projectGroups.save',
      token: args.token ?? 'session-a',
      input: { name: args.name },
    }),
  projectCall: (args: { procedure: string; input: object; token?: string }) =>
    trpcMutation({
      app,
      path: `projectResources.${args.procedure}`,
      token: args.token ?? 'session-a',
      input: args.input,
    }),
  projectQuery: (args: { procedure: string; input: object; token?: string }) =>
    trpcQuery({
      app,
      path: `projectResources.${args.procedure}`,
      token: args.token ?? 'session-a',
      input: args.input,
    }),
})
