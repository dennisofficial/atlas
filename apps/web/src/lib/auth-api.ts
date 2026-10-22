export enum EAuthErrorCode {
  InvalidToken = 'INVALID_TOKEN',
  UserAlreadyExists = 'USER_ALREADY_EXISTS',
  UserAlreadyExistsUseAnotherEmail = 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
}

export class AuthApiError extends Error {
  readonly code: string | undefined

  constructor(message: string, options: { code?: string | undefined } = {}) {
    super(message)
    this.code = options.code
  }
}

export const isAccountExistsError = (cause: unknown): boolean =>
  cause instanceof AuthApiError &&
  (cause.code === EAuthErrorCode.UserAlreadyExists ||
    cause.code === EAuthErrorCode.UserAlreadyExistsUseAnotherEmail)

export const isInvalidTokenError = (cause: unknown): boolean =>
  cause instanceof AuthApiError && cause.code === EAuthErrorCode.InvalidToken

export const UNREACHABLE =
  'Could not reach Atlas Cloud — check your connection and retry.'

export function normalizeUserCode(raw: string | null): string {
  return (raw ?? '').trim().replace(/-/g, '').toUpperCase()
}

export function formatUserCode(raw: string | null): string {
  const code = normalizeUserCode(raw)
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}

type SessionBody = { user?: unknown } | null

const readBody = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json().catch(() => ({}))) as Record<string, unknown>

const failWith = async (response: Response, fallback: string): Promise<never> => {
  const body = await readBody(response)
  const message =
    typeof body.message === 'string'
      ? body.message
      : typeof body.error_description === 'string'
        ? body.error_description
        : fallback
  throw new AuthApiError(message, {
    code: typeof body.code === 'string' ? body.code : undefined,
  })
}

export async function sessionUserPresent(): Promise<boolean> {
  let response: Response
  try {
    response = await fetch('/api/auth/get-session')
  } catch {
    throw new AuthApiError(UNREACHABLE)
  }
  if (!response.ok) return false

  const body = (await response.json().catch(() => null)) as SessionBody
  return body !== null && body.user !== null && body.user !== undefined
}

export async function signIn(args: { email: string; password: string }): Promise<void> {
  let response: Response
  try {
    response = await fetch('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: args.email, password: args.password }),
    })
  } catch {
    throw new AuthApiError(UNREACHABLE)
  }
  if (!response.ok) await failWith(response, 'Invalid email or password')
}

export async function signUp(args: {
  name: string
  email: string
  password: string
}): Promise<void> {
  let response: Response
  try {
    response = await fetch('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: args.name, email: args.email, password: args.password }),
    })
  } catch {
    throw new AuthApiError(UNREACHABLE)
  }
  if (!response.ok) await failWith(response, 'Sign-up failed')
}

export async function claimDeviceCode(userCode: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(`/api/auth/device?user_code=${encodeURIComponent(userCode)}`, {
      headers: { accept: 'application/json' },
    })
  } catch {
    throw new AuthApiError(UNREACHABLE)
  }
  if (!response.ok) await failWith(response, 'Unknown or expired device code')
}

export type DeviceAction = 'approve' | 'deny'

export async function actOnDevice(args: {
  action: DeviceAction
  userCode: string
}): Promise<void> {
  let response: Response
  try {
    response = await fetch(`/api/auth/device/${args.action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userCode: args.userCode }),
    })
  } catch {
    throw new AuthApiError(UNREACHABLE)
  }
  if (!response.ok) await failWith(response, 'Request failed')
}

export type SessionUser = {
  name: string
  email: string
  image: string | null
}

type SessionUserBody = {
  user?: { name?: unknown; email?: unknown; image?: unknown } | null
} | null

export async function sessionUser(): Promise<SessionUser | null> {
  let response: Response
  try {
    response = await fetch('/api/auth/get-session')
  } catch {
    throw new AuthApiError(UNREACHABLE)
  }
  if (!response.ok) return null

  const body = (await response.json().catch(() => null)) as SessionUserBody
  const user = body?.user
  if (user === null || user === undefined) return null
  const email = typeof user.email === 'string' ? user.email : ''
  const name = typeof user.name === 'string' && user.name.length > 0 ? user.name : email
  return { name, email, image: typeof user.image === 'string' ? user.image : null }
}

const postJson = async (args: { path: string; body: unknown }): Promise<Response> => {
  try {
    return await fetch(args.path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args.body),
    })
  } catch {
    throw new AuthApiError(UNREACHABLE)
  }
}

export async function googleSignInUrl(args: {
  origin: string
  next: string | null
}): Promise<string> {
  const { origin, next } = args
  const errorPath =
    next === null ? '/sign-in?error=google' : `/sign-in?error=google&next=${encodeURIComponent(next)}`
  const response = await postJson({
    path: '/api/auth/sign-in/social',
    body: {
      provider: 'google',
      callbackURL: `${origin}${next ?? '/'}`,
      newUserCallbackURL: `${origin}${next ?? '/setup'}`,
      errorCallbackURL: `${origin}${errorPath}`,
    },
  })
  if (!response.ok) await failWith(response, 'Google sign-in is unavailable')
  const body = await readBody(response)
  if (typeof body.url !== 'string') throw new AuthApiError('Google sign-in is unavailable')
  return body.url
}

export async function signOut(): Promise<void> {
  const response = await postJson({ path: '/api/auth/sign-out', body: {} })
  if (!response.ok) await failWith(response, 'Sign-out failed')
}

export async function requestPasswordReset(args: {
  email: string
  origin: string
}): Promise<void> {
  const response = await postJson({
    path: '/api/auth/request-password-reset',
    body: { email: args.email, redirectTo: `${args.origin}/reset-password` },
  })
  if (!response.ok) await failWith(response, 'Could not send the reset link')
}

export async function resetPassword(args: {
  newPassword: string
  token: string
}): Promise<void> {
  const response = await postJson({
    path: '/api/auth/reset-password',
    body: { newPassword: args.newPassword, token: args.token },
  })
  if (!response.ok) await failWith(response, 'Could not reset the password')
}
