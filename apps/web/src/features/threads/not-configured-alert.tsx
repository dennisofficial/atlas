import Link from 'next/link'
import { KeyRoundIcon } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'
import { EVercelCredentialGap } from '@dltech/atlas-wire/web'

import { ESettingsPage, hrefOfPage } from '@/features/settings/settings-nav'

export type CredentialLink = { page: ESettingsPage; label: string }

export const credentialLinkOf = (gap: EVercelCredentialGap | undefined): CredentialLink =>
  gap === EVercelCredentialGap.UserCredential
    ? { page: ESettingsPage.Secrets, label: 'Open your settings' }
    : { page: ESettingsPage.WorkspaceSecrets, label: 'Open workspace settings' }

export function NotConfiguredAlert({
  error,
  gap,
}: {
  error: string
  gap?: EVercelCredentialGap | undefined
}) {
  const link = credentialLinkOf(gap)
  return (
    <Alert variant="destructive">
      <KeyRoundIcon />
      <AlertTitle>Atlas can&apos;t start a sandbox yet</AlertTitle>
      <AlertDescription>
        {error} <Link href={hrefOfPage(link.page)}>{link.label}</Link>
      </AlertDescription>
    </Alert>
  )
}
