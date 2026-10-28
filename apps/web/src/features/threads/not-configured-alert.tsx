import Link from 'next/link'
import { KeyRoundIcon } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'

import { ESettingsPage, hrefOfPage } from '@/features/settings/settings-nav'

export function NotConfiguredAlert({ error }: { error: string }) {
  return (
    <Alert variant="destructive">
      <KeyRoundIcon />
      <AlertTitle>Atlas can&apos;t start a sandbox yet</AlertTitle>
      <AlertDescription>
        {error} <Link href={hrefOfPage(ESettingsPage.UsageSandboxes)}>Open your settings</Link>
      </AlertDescription>
    </Alert>
  )
}
