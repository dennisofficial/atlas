'use client'

import { useState } from 'react'
import { XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { ECapability, revokeGrant } from '@dltech/atlas-client/channel'
import { grantsFrom } from '@dltech/atlas-core'
import { Button } from '@dltech/atlas-ui/components/button'

import { messageOf } from '../../data/use-send'
import { useServeSupports } from '../../data/use-serve-supports'
import { useThreadPanel } from '../thread-panel-context'
import { DetailsSection } from './section'

export function GrantsSection() {
  const { threadId, channel, details } = useThreadPanel()
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const revocable = useServeSupports({ channel, capability: ECapability.RevokeGrant })
  const grants = grantsFrom(details.events)
  if (grants.length === 0) return null

  const handleRevoke = async (grantId: string) => {
    if (channel === null || pending.has(grantId)) return
    setPending((held) => new Set(held).add(grantId))
    try {
      await revokeGrant({ channel, threadId, grantId })
    } catch (failure) {
      toast.error(messageOf(failure))
    } finally {
      setPending((held) => {
        const next = new Set(held)
        next.delete(grantId)
        return next
      })
    }
  }

  return (
    <DetailsSection title="Grants" count={grants.length}>
      {grants.map((grant) => (
        <div key={grant.grantId} className="flex items-center gap-2 px-1 py-0.5">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-mono text-sm">{grant.subject}</span>
            <span className="truncate text-xs text-muted-foreground">
              {grant.dimensions.join(', ')}
            </span>
          </div>
          {revocable && (
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={channel === null || pending.has(grant.grantId)}
              aria-label={`Revoke ${grant.subject}`}
              onClick={() => void handleRevoke(grant.grantId)}
            >
              <XIcon />
            </Button>
          )}
        </div>
      ))}
    </DetailsSection>
  )
}
