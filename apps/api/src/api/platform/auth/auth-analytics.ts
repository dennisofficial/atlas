import type { ProductAnalytics } from '@dltech/atlas-observability'

export type AuthHookContext = { path?: string | undefined } | null

const SOCIAL_PATH = /\/sign-in\/social\/([^/]+)/

/** The credential a sign-up or sign-in arrived on, read from the endpoint better-auth routed. */
export const authMethodOf = (context: AuthHookContext): string => {
  const path = context?.path ?? ''
  const social = SOCIAL_PATH.exec(path)
  if (social?.[1] !== undefined) return social[1]
  if (path.includes('/email')) return 'email'
  if (path.includes('/device')) return 'device'
  return 'unknown'
}

export const captureSignedUp = (
  analytics: ProductAnalytics,
  user: { id: string; email?: string | undefined },
  context: AuthHookContext,
): void => {
  analytics.capture({
    userId: user.id,
    event: 'signed_up',
    properties: {
      method: authMethodOf(context),
      ...(user.email === undefined ? {} : { $set: { email: user.email } }),
    },
  })
}

export const captureSignedIn = (
  analytics: ProductAnalytics,
  session: { userId: string },
  context: AuthHookContext,
): void => {
  analytics.capture({
    userId: session.userId,
    event: 'signed_in',
    properties: { method: authMethodOf(context) },
  })
}
