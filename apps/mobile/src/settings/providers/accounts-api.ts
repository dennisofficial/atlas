import type { ApiClient } from '@dltech/atlas-api-router'
import { AUTH_PROVIDER_OF, DEFAULT_API_KEY_LABEL, EProviderId } from '@dltech/atlas-client/settings'
import { EAccountOrigin, EAuthKind } from '@dltech/atlas-wire/web'

export const createProviderAccountsApi = (api: ApiClient) => ({
  load: async () => {
    const [accounts, active] = await Promise.all([
      api.accounts.list.query(),
      Promise.all(
        Object.values(EProviderId).map(
          async (provider) =>
            [
              provider,
              (await api.accounts.active.query({ provider: AUTH_PROVIDER_OF[provider] })).accountId,
            ] as const,
        ),
      ),
    ])
    return { accounts, active: Object.fromEntries(active) }
  },
  add: (args: { provider: EProviderId; key: string; name?: string; use?: boolean }) =>
    api.accounts.create.mutate({
      provider: AUTH_PROVIDER_OF[args.provider],
      label: args.name ?? DEFAULT_API_KEY_LABEL,
      origin: EAccountOrigin.Login,
      secret: { kind: EAuthKind.ApiKey, apiKey: args.key },
      makeActive: args.use,
    }),
  replace: (args: { accountId: string; key: string }) =>
    api.accounts.replaceSecret.mutate({
      accountId: args.accountId,
      secret: { kind: EAuthKind.ApiKey, apiKey: args.key },
    }),
  rename: (args: { accountId: string; name: string }) =>
    api.accounts.rename.mutate({ accountId: args.accountId, label: args.name }),
  activate: (args: { provider: EProviderId; accountId: string }) =>
    api.accounts.setActive.mutate({
      provider: AUTH_PROVIDER_OF[args.provider],
      accountId: args.accountId,
    }),
  remove: (accountId: string) => api.accounts.remove.mutate({ accountId }),
})
