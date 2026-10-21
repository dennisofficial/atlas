'use client'

import { Button } from '@dltech/atlas-ui/components/button'

import { PENDING_DEVICE_CODE } from '../fixtures/settings-security'
import { SettingsRow } from '../settings-layout'

export function PendingCodeRow({
  onApprove,
  onDeny,
}: {
  onApprove: () => void
  onDeny: () => void
}) {
  return (
    <SettingsRow
      title={
        <span className="rounded-md border bg-muted px-2 py-0.5 font-mono text-sm tracking-widest">
          {PENDING_DEVICE_CODE.code}
        </span>
      }
      description={
        <>
          {PENDING_DEVICE_CODE.requested}
          <span className="font-mono text-xs"> · {PENDING_DEVICE_CODE.origin}</span>
        </>
      }
      control={
        <>
          <Button variant="ghost" size="sm" onClick={onDeny}>
            Deny
          </Button>
          <Button size="sm" onClick={onApprove}>
            Approve
          </Button>
        </>
      }
    />
  )
}
