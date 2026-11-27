import { z } from 'zod'

import { signInMethodsOf, type ISignInMethodIds } from './sign-in-methods'

export const UNREACHABLE = 'Could not reach Atlas Cloud — check your connection and retry.'
export const SESSION_NOT_FRESH = 'SESSION_NOT_FRESH'
export const SIGN_IN_AGAIN = 'Sign out and back in, then remove this sign-in method.'
export const RESET_LINK_FAILED = 'Could not send the reset link'

export const sessionSchema = z.object({
  id: z.string(),
  token: z.string(),
  userAgent: z.string().nullish(),
  ipAddress: z.string().nullish(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  expiresAt: z.string(),
})

export const currentSessionSchema = z.object({
  session: z.object({ token: z.string() }).nullish(),
  user: z
    .object({ name: z.string(), email: z.string(), createdAt: z.string().optional() })
    .nullish(),
})

export const accountSchema = z.object({ id: z.string(), providerId: z.string() })

export type IAuthSession = z.infer<typeof sessionSchema>
export type ICurrentSession = z.infer<typeof currentSessionSchema>

export class AuthAccountError extends Error {
  readonly code: string | undefined
  readonly status: number

  constructor({ message, status, code }: { message: string; status: number; code?: string }) {
    super(message)
    this.code = code
    this.status = status
  }
}

export const unlinkRefusalOf = ({
  message,
  code,
}: {
  message: string
  code: string | undefined
}): { message: string; code: string | undefined } =>
  code === SESSION_NOT_FRESH ? { message: SIGN_IN_AGAIN, code } : { message, code }

export type IAuthAccountApi = {
  getCurrentSession: () => Promise<ICurrentSession>
  updateName: (name: string) => Promise<void>
  listSessions: () => Promise<IAuthSession[]>
  listSignInMethods: () => Promise<ISignInMethodIds>
  unlinkAccount: (accountId: string) => Promise<void>
  revokeSession: (token: string) => Promise<void>
  revokeOtherSessions: () => Promise<void>
  requestPasswordReset: (args: { email: string; redirectTo: string }) => Promise<void>
}

const errorBodyOf = (payload: unknown): { message: string; code: string | undefined } => {
  if (typeof payload !== 'object' || payload === null) return { message: '', code: undefined }
  const message = 'message' in payload && typeof payload.message === 'string' ? payload.message : ''
  const code = 'code' in payload && typeof payload.code === 'string' ? payload.code : undefined
  return { message, code }
}

export const createAuthAccountApi = ({
  baseUrl,
  token,
  fetchFn = fetch,
}: {
  baseUrl: string
  token: string
  fetchFn?: typeof fetch
}): IAuthAccountApi => {
  const request = async ({
    path,
    body,
    fallback,
  }: {
    path: string
    body?: unknown
    fallback: string
  }): Promise<unknown> => {
    let response: Response
    try {
      response = await fetchFn(`${baseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'omit',
        cache: 'no-store',
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      throw new AuthAccountError({ message: UNREACHABLE, status: 0 })
    }
    const payload: unknown = await response.json().catch(() => null)
    if (response.ok) return payload
    const failure = errorBodyOf(payload)
    throw new AuthAccountError({
      message: failure.message.length > 0 ? failure.message : fallback,
      status: response.status,
      ...(failure.code === undefined ? {} : { code: failure.code }),
    })
  }

  const parse = <T>(schema: z.ZodType<T>, payload: unknown, fallback: string): T => {
    const parsed = schema.safeParse(payload)
    if (!parsed.success) throw new AuthAccountError({ message: fallback, status: 0 })
    return parsed.data
  }

  return {
    getCurrentSession: async () =>
      parse(
        currentSessionSchema,
        await request({ path: '/api/auth/get-session', fallback: 'Could not load your account' }),
        'Could not load your account',
      ),
    updateName: async (name: string) => {
      await request({
        path: '/api/auth/update-user',
        body: { name },
        fallback: 'Your name could not be saved',
      })
    },
    listSessions: async () =>
      parse(
        z.array(sessionSchema),
        await request({ path: '/api/auth/list-sessions', fallback: 'Could not load your devices' }),
        'Could not load your devices',
      ),
    listSignInMethods: async () =>
      signInMethodsOf(
        parse(
          z.array(accountSchema),
          await request({
            path: '/api/auth/list-accounts',
            fallback: 'Could not load your sign-in methods',
          }),
          'Could not load your sign-in methods',
        ),
      ),
    unlinkAccount: async (accountId: string) => {
      try {
        await request({
          path: '/api/auth/unlink-account',
          body: { accountId },
          fallback: 'Could not remove that sign-in method',
        })
      } catch (cause) {
        if (cause instanceof AuthAccountError) {
          const refusal = unlinkRefusalOf({ message: cause.message, code: cause.code })
          throw new AuthAccountError({
            message: refusal.message,
            status: cause.status,
            ...(refusal.code === undefined ? {} : { code: refusal.code }),
          })
        }
        throw cause
      }
    },
    revokeSession: async (token: string) => {
      await request({
        path: '/api/auth/revoke-session',
        body: { token },
        fallback: 'That device could not be signed out',
      })
    },
    revokeOtherSessions: async () => {
      await request({
        path: '/api/auth/revoke-other-sessions',
        body: {},
        fallback: 'Your other devices could not be signed out',
      })
    },
    requestPasswordReset: async ({ email, redirectTo }: { email: string; redirectTo: string }) => {
      await request({
        path: '/api/auth/request-password-reset',
        body: { email, redirectTo },
        fallback: RESET_LINK_FAILED,
      })
    },
  }
}
