import { EAuthKind, EAuthProvider, toAccountId, type CredentialPort } from '@dltech/atlas-core'

import { CodexModelsCatalogue } from './codex-models-catalogue'
import type { CodexModelsPorts } from './codex-ports'

export type CodexLogin = {
  accessToken: string
  expiresAt: string
  connectionId: string
  providerAccountId?: string | undefined
}

export function codexCatalogueFor(args: {
  login: () => Promise<CodexLogin>
  ports: CodexModelsPorts
  clientVersion: string
}): CodexModelsCatalogue {
  const credentials: CredentialPort = {
    read: async () => {
      const login = await args.login()
      return {
        kind: EAuthKind.Oauth,
        accountId: toAccountId(login.connectionId),
        accessToken: login.accessToken,
        expiresAt: login.expiresAt,
        providerAccountId: login.providerAccountId,
      }
    },
    discard: async () => {},
  }
  return new CodexModelsCatalogue({
    credentials,
    provider: EAuthProvider.OpenAI,
    clientVersion: args.clientVersion,
    ports: args.ports,
  })
}
