import { EVercelCredentialGap } from '@dltech/atlas-wire/web'

const GAP_MESSAGES: Record<EVercelCredentialGap, string> = {
  [EVercelCredentialGap.ProjectWorkspace]:
    'This project belongs to no workspace. Pick a workspace in Project → Overview.',
  [EVercelCredentialGap.WorkspaceCredential]:
    'This workspace has no Vercel credential. Add a Vercel token and team in Workspace → Secrets & Env Vars.',
  [EVercelCredentialGap.ProjectId]:
    'This project has no Vercel project ID. Set it in Project → Sandbox.',
}

export class VercelNotConfiguredError extends Error {
  readonly gap: EVercelCredentialGap

  constructor(gap: EVercelCredentialGap) {
    super(GAP_MESSAGES[gap])
    this.name = 'VercelNotConfiguredError'
    this.gap = gap
  }
}
