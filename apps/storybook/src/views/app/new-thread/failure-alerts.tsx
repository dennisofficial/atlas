import { KeyRoundIcon } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'
import { Button } from '@dltech/atlas-ui/components/button'

export function NoVercelTokenAlert({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert>
      <KeyRoundIcon />
      <AlertTitle>Add a Vercel token to run threads</AlertTitle>
      <AlertDescription>
        Atlas runs each thread in a pod on your Vercel account. Add{' '}
        <code className="font-mono text-[0.85em] text-foreground">VERCEL_TOKEN</code> under Settings
        → Secrets, then retry.
      </AlertDescription>
      <div className="mt-2 flex gap-2 group-has-[>svg]/alert:col-start-2">
        <Button size="sm">Open secrets</Button>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </Alert>
  )
}
