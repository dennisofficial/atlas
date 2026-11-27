import { createApiClient } from '@dltech/atlas-api-router'

export type LoginExchange = (args: {
  code: string
  codeVerifier: string
  redirectUri: string
}) => Promise<string>

export const loginExchangeOf = (args: {
  apiUrl: string
  fetchFn?: typeof fetch | undefined
}): LoginExchange => {
  const client = createApiClient({
    baseUrl: args.apiUrl,
    ...(args.fetchFn === undefined ? {} : { fetchFn: args.fetchFn }),
  })

  return async (login) => {
    const { token } = await client.desktopAuth.exchange.mutate(login)
    return token
  }
}
