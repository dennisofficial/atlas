import { EVercelCredentialGap } from '@dltech/atlas-wire/web'

const GAP_MESSAGES: Record<EVercelCredentialGap, string> = {
  [EVercelCredentialGap.UserCredential]:
    'Your account has no Vercel credential. Add a Vercel token, team and project in Settings → Sandboxes.',
}

export class VercelNotConfiguredError extends Error {
  readonly gap: EVercelCredentialGap

  constructor(gap: EVercelCredentialGap) {
    super(GAP_MESSAGES[gap])
    this.name = 'VercelNotConfiguredError'
    this.gap = gap
  }
}
