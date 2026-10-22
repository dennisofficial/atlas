'use client'

import { Check, Copy, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { BrandMark, EBrand } from '@dltech/atlas-ui/components/brand-mark'
import { Button } from '@dltech/atlas-ui/components/button'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { CONTROL_CLASS } from './auth-controls'
import { AuthHeading } from './auth-heading'

const INSTALL_COMMAND = 'curl -fsSL https://install.byatlas.io | bash'
const LOGIN_COMMAND = 'atlas login'
const COPIED_FLASH_MS = 1600

function CopyRow({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(command).catch(() => undefined)
    setCopied(true)
    window.setTimeout(() => setCopied(false), COPIED_FLASH_MS)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
        <code className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
          <span className="text-muted-foreground select-none">$ </span>
          {command}
        </code>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Copy ${label}`}
          onClick={() => void handleCopy()}
        >
          {copied ? <Check className="text-success" /> : <Copy />}
        </Button>
      </div>
    </div>
  )
}

export function SetupDone() {
  return (
    <div className="flex flex-col gap-6">
      <AuthHeading
        title="You're set"
        description="Your workspace is ready. Pick up where you like."
      />
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 rounded-xl border p-3">
          <BrandMark brand={EBrand.GitHub} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-medium text-foreground">Connect GitHub</span>
            <span className="text-xs text-muted-foreground">
              Let agents clone, branch, and open pull requests.
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/settings/integrations" />}
          >
            Connect
          </Button>
        </div>
        <CopyRow label="Install the terminal app" command={INSTALL_COMMAND} />
        <CopyRow label="Then sign in from your terminal" command={LOGIN_COMMAND} />
      </div>
      <Button
        className={cn(CONTROL_CLASS, 'w-full')}
        nativeButton={false}
        render={<Link href="/threads/new" />}
      >
        Open Atlas Cloud
        <ExternalLink data-icon="inline-end" />
      </Button>
    </div>
  )
}
