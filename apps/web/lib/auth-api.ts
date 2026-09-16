export class AuthApiError extends Error {}

export const UNREACHABLE =
  'Could not reach Atlas Cloud — check your connection and retry.'

export function normalizeUserCode(raw: string | null): string {
  return (raw ?? '').trim().replace(/-/g, '').toUpperCase()
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
  throw new AuthApiError(message)
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
