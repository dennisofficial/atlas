import { EAccessScope, type AccessScope } from '@dltech/atlas-wire'
import type { INestApplication } from '@nestjs/common'
import { projectProviders } from '../projects/projects.router.fixture'
import { SecretsRouter } from '../secrets/secrets.router'
import { SecretsService } from '../secrets/secrets.service'
import { UserFileMountsRouter } from '../user-file-mounts/user-file-mounts.router'
import { UserFileMountsService } from '../user-file-mounts/user-file-mounts.service'
import { buildSessionTrpcApp, dataOf, trpcMutation, trpcQuery } from '../session-trpc-test-app'
import { AccessGrantsRouter } from './access-grants.router'
import { AccessGrantsService } from './access-grants.service'
import { PersonalAccessGrantsService } from './personal-access-grants.service'
import { ProjectAccessGrantsService } from './project-access-grants.service'

export const PERSONAL: AccessScope = { kind: EAccessScope.Personal }

export const projectScope = (projectId: string): AccessScope => ({
  kind: EAccessScope.Project,
  projectId,
})

export type Grant = {
  id: string
  name: string
  instruction: string
  secrets: { name: string; updatedAt: string }[]
  files: { path: string; mode: number; updatedAt: string }[]
  updatedAt: string
}

export const buildAccessGrantsApp = (): Promise<INestApplication> =>
  buildSessionTrpcApp({
    providers: [
      ...projectProviders({ 'user-a': 'gho_a' }),
      SecretsService,
      SecretsRouter,
      UserFileMountsService,
      UserFileMountsRouter,
      AccessGrantsService,
      PersonalAccessGrantsService,
      ProjectAccessGrantsService,
      AccessGrantsRouter,
    ],
  })

export const savedId = (body: unknown): string => (dataOf(body) as { id: string }).id

export const accessGrantApi = (app: INestApplication) => ({
  list: async (args: { scope: AccessScope; token?: string }): Promise<Grant[]> => {
    const response = await trpcQuery({
      app,
      path: 'accessGrants.list',
      token: args.token ?? 'session-a',
      input: { scope: args.scope },
    }).expect(200)
    return (dataOf(response.body) as { grants: Grant[] }).grants
  },
  save: (args: { input: object; token?: string }) =>
    trpcMutation({
      app,
      path: 'accessGrants.save',
      token: args.token ?? 'session-a',
      input: args.input,
    }),
  remove: (args: { scope: AccessScope; id: string; token?: string }) =>
    trpcMutation({
      app,
      path: 'accessGrants.remove',
      token: args.token ?? 'session-a',
      input: { scope: args.scope, id: args.id },
    }),
  moveMember: (args: { input: object; token?: string }) =>
    trpcMutation({
      app,
      path: 'accessGrants.moveMember',
      token: args.token ?? 'session-a',
      input: args.input,
    }),
  setSecret: (args: { name: string; value: string; grantId?: string; token?: string }) =>
    trpcMutation({
      app,
      path: 'secrets.set',
      token: args.token ?? 'session-a',
      input: { name: args.name, value: args.value, grantId: args.grantId },
    }),
  removeSecret: (args: { name: string; token?: string }) =>
    trpcMutation({
      app,
      path: 'secrets.remove',
      token: args.token ?? 'session-a',
      input: { name: args.name },
    }),
  personalMount: (args: { procedure: string; input?: object; token?: string }) =>
    trpcMutation({
      app,
      path: `personalFileMounts.${args.procedure}`,
      token: args.token ?? 'session-a',
      input: args.input,
    }),
  personalMountQuery: (args: { procedure: string; input?: object; token?: string }) =>
    trpcQuery({
      app,
      path: `personalFileMounts.${args.procedure}`,
      token: args.token ?? 'session-a',
      input: args.input,
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
