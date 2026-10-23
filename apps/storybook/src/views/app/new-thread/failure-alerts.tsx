import { KeyRoundIcon } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'
import { Button } from '@dltech/atlas-ui/components/button'

export function NoVercelTokenAlert({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert>
      <KeyRoundIcon />
      <AlertTitle>Add your Vercel credential to run threads</AlertTitle>
      <AlertDescription>
        Atlas runs each thread in a sandbox on your Vercel account. Add your token, team and project
        under Settings → Sandbox, then retry.
      </AlertDescription>
      <div className="mt-2 flex gap-2 group-has-[>svg]/alert:col-start-2">
        <Button size="sm">Open Sandbox settings</Button>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </Alert>
  )
}
