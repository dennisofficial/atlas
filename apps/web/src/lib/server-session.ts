import { cookies } from 'next/headers'

import { resolveApiOrigin } from './api-origin'

const SERVER_ERROR_STATUS = 500

export function sessionBodyHasUser(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false
  const user = (body as { user?: unknown }).user
  return user !== null && user !== undefined
}

export async function readServerSession(): Promise<boolean> {
  const cookieHeader = (await cookies()).toString()
  const response = await fetch(`${resolveApiOrigin(process.env)}/api/auth/get-session`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  })
  if (response.status >= SERVER_ERROR_STATUS) {
    throw new Error(`Session check failed with status ${response.status}`)
  }
  if (!response.ok) return false
  return sessionBodyHasUser(await response.json().catch(() => null))
}
