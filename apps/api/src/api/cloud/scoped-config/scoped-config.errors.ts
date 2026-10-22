import { EVercelCredentialGap } from '@dltech/atlas-wire/web'

const GAP_MESSAGES: Record<EVercelCredentialGap, string> = {
  [EVercelCredentialGap.UserCredential]:
    'Your account has no Vercel credential. Add a Vercel token, team and project in Settings → Secrets & Env Vars.',
  [EVercelCredentialGap.WorkspaceCredential]:
    'This workspace has no Vercel credential. Add a Vercel token, team and project in Workspace → Secrets & Env Vars.',
  [EVercelCredentialGap.CredentialProjectId]:
    'This workspace Vercel credential has no Vercel project ID. Add it in Workspace → Secrets & Env Vars.',
}

export class VercelNotConfiguredError extends Error {
  readonly gap: EVercelCredentialGap

  constructor(gap: EVercelCredentialGap) {
    super(GAP_MESSAGES[gap])
    this.name = 'VercelNotConfiguredError'
    this.gap = gap
  }
}
