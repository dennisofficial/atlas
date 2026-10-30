export const PR_EDIT_MUTED_AUTHORS_FALLBACK = 'vercel, github-actions, netlify, mintlify'
export const PR_EDIT_URGENT_AUTHORS_FALLBACK = ''

export enum EEditDisposition {
  Muted = 'muted',
  Urgent = 'urgent',
  Routine = 'routine',
}

export type PrEditPolicy = {
  muted: ReadonlySet<string>
  urgent: ReadonlySet<string>
}

const BOT_SUFFIX = /\[bot\]$/

const normalisedLogin = (login: string): string =>
  login.trim().toLowerCase().replace(BOT_SUFFIX, '')

export const authorListOf = (raw: string): ReadonlySet<string> =>
  new Set(
    raw
      .split(',')
      .map(normalisedLogin)
      .filter((login) => login !== ''),
  )

export const DEFAULT_PR_EDIT_POLICY: PrEditPolicy = {
  muted: authorListOf(PR_EDIT_MUTED_AUTHORS_FALLBACK),
  urgent: authorListOf(PR_EDIT_URGENT_AUTHORS_FALLBACK),
}

export function editDispositionOf({
  authorLogin,
  policy,
}: {
  authorLogin: string | undefined
  policy: PrEditPolicy
}): EEditDisposition {
  if (authorLogin === undefined) return EEditDisposition.Routine
  const login = normalisedLogin(authorLogin)
  if (policy.muted.has(login)) return EEditDisposition.Muted
  if (policy.urgent.has(login)) return EEditDisposition.Urgent
  return EEditDisposition.Routine
}
