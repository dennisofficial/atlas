export type ISignInMethodIds = {
  google: string | null
  password: string | null
}

export type IAccountRow = {
  id: string
  providerId: string
}

export enum ESignInMethodProvider {
  Google = 'google',
  Password = 'password',
}

export enum ESignInMethodAction {
  Link = 'link',
  Unlink = 'unlink',
  SendSetupLink = 'send-setup-link',
  Remove = 'remove',
}

export type ISignInMethodRow = {
  provider: ESignInMethodProvider
  label: string
  linked: boolean
  badge: string
  description: string
  action: ESignInMethodAction
  actionLabel: string
  primary: boolean
  disabled: boolean
}

export const ONLY_METHOD = 'Your only sign-in method. Add another before removing it.'
export const SETUP_LINK_SENT = 'Check your email to set a password.'
export const GOOGLE_UNLINKED = 'Google unlinked'
export const PASSWORD_REMOVED = 'Password removed'

const GOOGLE_PROVIDER = 'google'
const CREDENTIAL_PROVIDER = 'credential'

export const signInMethodsOf = (accounts: readonly IAccountRow[]): ISignInMethodIds => {
  const idOf = (providerId: string): string | null =>
    accounts.find((account) => account.providerId === providerId)?.id ?? null
  return { google: idOf(GOOGLE_PROVIDER), password: idOf(CREDENTIAL_PROVIDER) }
}

export const signInMethodRowsOf = ({
  methods,
  busy,
}: {
  methods: ISignInMethodIds
  busy: boolean
}): ISignInMethodRow[] => {
  const hasGoogle = methods.google !== null
  const hasPassword = methods.password !== null
  const onlyMethod = hasGoogle !== hasPassword
  return [
    {
      provider: ESignInMethodProvider.Google,
      label: 'Google',
      linked: hasGoogle,
      badge: hasGoogle ? 'Linked' : 'Not linked',
      description: hasGoogle
        ? onlyMethod
          ? ONLY_METHOD
          : 'Sign in with your Google account.'
        : 'Link your Google account to sign in without a password.',
      action: hasGoogle ? ESignInMethodAction.Unlink : ESignInMethodAction.Link,
      actionLabel: hasGoogle ? 'Unlink' : 'Link Google',
      primary: !hasGoogle,
      disabled: hasGoogle ? onlyMethod || busy : busy,
    },
    {
      provider: ESignInMethodProvider.Password,
      label: 'Password',
      linked: hasPassword,
      badge: hasPassword ? 'Set' : 'Not set',
      description: hasPassword
        ? onlyMethod
          ? ONLY_METHOD
          : 'Sign in with your email and password.'
        : 'Set a password to sign in with your email.',
      action: hasPassword ? ESignInMethodAction.Remove : ESignInMethodAction.SendSetupLink,
      actionLabel: hasPassword ? 'Remove' : 'Send setup link',
      primary: false,
      disabled: hasPassword ? onlyMethod || busy : busy,
    },
  ]
}
