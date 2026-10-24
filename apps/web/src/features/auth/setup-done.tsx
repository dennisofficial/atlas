'use client'

import { Check, Copy, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { BrandMark, EBrand } from '@dltech/atlas-ui/components/brand-mark'
import { Button } from '@dltech/atlas-ui/components/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@dltech/atlas-ui/components/item'

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
      <Item variant="outline" size="sm" className="flex-nowrap">
        <ItemContent className="min-w-0">
          <code className="truncate font-mono text-sm text-foreground">
            <span className="text-muted-foreground select-none">$ </span>
            {command}
          </code>
        </ItemContent>
        <ItemActions>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Copy ${label}`}
            onClick={() => void handleCopy()}
          >
            {copied ? <Check className="text-success" /> : <Copy />}
          </Button>
        </ItemActions>
      </Item>
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
        <Item variant="outline" className="flex-nowrap">
          <ItemMedia>
            <BrandMark brand={EBrand.GitHub} />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle>Connect GitHub</ItemTitle>
            <ItemDescription>Let agents clone, branch, and open pull requests.</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/settings/integrations" />}
            >
              Connect
            </Button>
          </ItemActions>
        </Item>
        <CopyRow label="Install the terminal app" command={INSTALL_COMMAND} />
        <CopyRow label="Then sign in from your terminal" command={LOGIN_COMMAND} />
      </div>
      <Button
        size="lg"
        className="w-full"
        nativeButton={false}
        render={<Link href="/threads/new" />}
      >
        Open Atlas Cloud
        <ExternalLink data-icon="inline-end" />
      </Button>
    </div>
  )
}
