import { AUTH_INVITATION_ID } from './fixtures/auth'

export const AUTH_PATHS = {
  home: '/',
  signIn: '/sign-in',
  signUp: '/sign-up',
  forgot: '/forgot-password',
  reset: '/reset-password',
  device: '/device',
  setup: '/setup',
  invite: `/invite/${AUTH_INVITATION_ID}`,
  newThread: '/threads/new',
  integrations: '/settings/github',
} as const

export function withState({ path, state }: { path: string; state: string }): string {
  return `${path}?state=${state}`
}

export function deviceStepHref({ step, code }: { step: string; code?: string }): string {
  const base = `${AUTH_PATHS.device}?step=${step}`
  return code ? `${base}&user_code=${encodeURIComponent(code)}` : base
}

export function signInHref(context: string): string {
  return `${AUTH_PATHS.signIn}?context=${context}`
}
