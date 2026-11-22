import { KeyRoundIcon } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'

export function NotConfiguredAlert({ error }: { error: string }) {
  return (
    <Alert variant="destructive">
      <KeyRoundIcon />
      <AlertTitle>Atlas can&apos;t start a sandbox yet</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  )
}
