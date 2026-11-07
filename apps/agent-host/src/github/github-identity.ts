import { z } from 'zod'

import type { GitIdentity, IdentityLookup } from '../runtime/shell-env'

const USER_URL = 'https://api.github.com/user'
const LOOKUP_TIMEOUT_MS = 10_000

const userSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
})

export const githubIdentityLookup =
  (args: { fetch?: typeof fetch | undefined }): IdentityLookup =>
  async ({ token, signal }): Promise<GitIdentity> => {
    const response = await (args.fetch ?? fetch)(USER_URL, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(LOOKUP_TIMEOUT_MS)]),
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
    })
    if (!response.ok)
      throw new Error(`GitHub answered ${response.status} for the authenticated user`)
    const { id, login } = userSchema.parse(await response.json())
    return { name: login, email: `${id}+${login}@users.noreply.github.com` }
  }
