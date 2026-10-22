export enum ELinkReturnKind {
  Success = 'success',
  Error = 'error',
}

export type LinkReturn = { kind: ELinkReturnKind; message: string }

export const GOOGLE_LINKED = 'Google linked'
export const GOOGLE_LINK_WRONG_EMAIL =
  'That Google account uses a different email than your Atlas account.'
export const GOOGLE_LINK_OTHER_ACCOUNT =
  'That Google account is already linked to another Atlas account.'
export const GOOGLE_LINK_FAILED = "Google linking didn't complete. Try again."

const ERROR_MESSAGES: Record<string, string> = {
  email_does_not_match: GOOGLE_LINK_WRONG_EMAIL,
  account_already_linked_to_different_user: GOOGLE_LINK_OTHER_ACCOUNT,
}

export function linkReturnOf(params: URLSearchParams): LinkReturn | null {
  const error = params.get('error')
  if (error !== null) {
    return { kind: ELinkReturnKind.Error, message: ERROR_MESSAGES[error] ?? GOOGLE_LINK_FAILED }
  }
  if (params.get('linked') === 'google') {
    return { kind: ELinkReturnKind.Success, message: GOOGLE_LINKED }
  }
  return null
}
