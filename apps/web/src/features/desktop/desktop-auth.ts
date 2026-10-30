import { z } from 'zod'

export enum EDesktopAuthState {
  Idle = 'idle',
  Pending = 'pending',
  SignedIn = 'signed-in',
  Expired = 'expired',
  Denied = 'denied',
}

const startSchema = z.object({ authorizeUrl: z.string().min(1) })
const statusSchema = z.object({
  state: z.enum(EDesktopAuthState),
  email: z.string().optional(),
})

export type DesktopAuthStart = z.infer<typeof startSchema>
export type DesktopAuthStatus = z.infer<typeof statusSchema>

async function request(args: { path: string; method: 'GET' | 'POST' }): Promise<Response> {
  const response = await fetch(args.path, { method: args.method })
  if (!response.ok) throw new Error(response.statusText || `Request failed (${response.status})`)
  return response
}

export async function startDesktopSignIn(): Promise<DesktopAuthStart> {
  const response = await request({ path: '/desktop/auth/start', method: 'POST' })
  return startSchema.parse(await response.json())
}

export async function desktopAuthStatus(): Promise<DesktopAuthStatus> {
  const response = await request({ path: '/desktop/auth/status', method: 'GET' })
  return statusSchema.parse(await response.json())
}

export async function desktopSignOut(): Promise<void> {
  await request({ path: '/desktop/auth/sign-out', method: 'POST' })
}
