import { useState } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'

import { Avatar, AvatarFallback } from '@dltech/atlas-ui/components/avatar'
import { Button } from '@dltech/atlas-ui/components/button'

import { WORKSPACE_DETAILS } from '../../../fixtures/settings-workspace'
import { Mono, SettingsCard, SettingsRow, SettingsSection } from '../settings-layout'

function CopyIdButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard?.writeText(value).catch(() => undefined)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Copy workspace ID" onClick={handleCopy}>
      {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
    </Button>
  )
}

export function WorkspaceDetailsCard() {
  return (
    <SettingsSection title="Details" description="Read-only identifiers for this workspace.">
      <SettingsCard>
        <SettingsRow
          title="Workspace ID"
          description="Use this when contacting support or calling the API."
          control={
            <>
              <Mono className="text-muted-foreground">{WORKSPACE_DETAILS.id}</Mono>
              <CopyIdButton value={WORKSPACE_DETAILS.id} />
            </>
          }
        />
        <SettingsRow
          title="Created"
          control={<Mono className="text-muted-foreground">{WORKSPACE_DETAILS.createdAt}</Mono>}
        />
        <SettingsRow
          title="Owner"
          control={
            <span className="flex items-center gap-2 text-sm">
              <Avatar size="sm">
                <AvatarFallback className="text-[10px]">
                  {WORKSPACE_DETAILS.ownerInitials}
                </AvatarFallback>
              </Avatar>
              {WORKSPACE_DETAILS.ownerName}
            </span>
          }
        />
      </SettingsCard>
    </SettingsSection>
  )
}
