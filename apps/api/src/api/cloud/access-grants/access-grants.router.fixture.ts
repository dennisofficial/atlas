import { EAccessScope, type AccessScope } from '@dltech/atlas-wire'
import type { INestApplication } from '@nestjs/common'
import { projectProviders } from '../projects/projects.router.fixture'
import { SecretsRouter } from '../secrets/secrets.router'
import { SecretsService } from '../secrets/secrets.service'
import { buildSessionTrpcApp, dataOf, trpcMutation, trpcQuery } from '../session-trpc-test-app'
import { AccessGrantsRouter } from './access-grants.router'
import { AccessGrantsService } from './access-grants.service'

export const PERSONAL: AccessScope = { kind: EAccessScope.Personal }

export const projectScope = (projectId: string): AccessScope => ({
  kind: EAccessScope.Project,
  projectId,
})

export type Grant = {
  id: string
  name: string
  instruction: string
  secretNames: string[]
  filePaths: string[]
  updatedAt: string
}

export const buildAccessGrantsApp = (): Promise<INestApplication> =>
  buildSessionTrpcApp({
    providers: [
      ...projectProviders({ 'user-a': 'gho_a' }),
      SecretsService,
      SecretsRouter,
      AccessGrantsService,
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
  setSecret: (args: { name: string; value: string; token?: string }) =>
    trpcMutation({
      app,
      path: 'secrets.set',
      token: args.token ?? 'session-a',
      input: { name: args.name, value: args.value },
    }),
  projectCall: (args: { procedure: string; input: object; token?: string }) =>
    trpcMutation({
      app,
      path: `projectResources.${args.procedure}`,
      token: args.token ?? 'session-a',
      input: args.input,
    }),
})
