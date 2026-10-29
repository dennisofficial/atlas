import { Check, Copy, ExternalLink } from 'lucide-react'
import Link from 'next/link'

import { Button } from '@dltech/atlas-ui/components/button'
import { BrandMark, EBrand } from '@dltech/atlas-ui/components/brand-mark'

import { LinkButton } from './auth-controls'
import { AuthHeading } from './auth-heading'
import { AUTH_PATHS } from './auth-paths'
import { AUTH_INSTALL_COMMAND, AUTH_LOGIN_COMMAND } from './fixtures/auth'
import { useCopied } from './use-copied'

function CopyRow({ label, command }: { label: string; command: string }) {
  const { copied, markCopied } = useCopied()

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
        <code className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
          <span className="text-muted-foreground select-none">$ </span>
          {command}
        </code>
        <Button variant="ghost" size="icon-sm" aria-label={`Copy ${label}`} onClick={markCopied}>
          {copied ? <Check className="text-success" /> : <Copy />}
        </Button>
      </div>
    </div>
  )
}

function NextAction({
  brand,
  title,
  description,
  action,
  href,
}: {
  brand: EBrand
  title: string
  description: string
  action: string
  href: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border p-3">
      <BrandMark brand={brand} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      <Button variant="outline" size="sm" nativeButton={false} render={<Link href={href} />}>
        {action}
      </Button>
    </div>
  )
}

export function SetupScreen() {
  return (
    <div className="flex flex-col gap-6">
      <AuthHeading
        title="You're set"
        description="Your account is ready. Pick up where you like."
      />
      <div className="flex flex-col gap-3">
        <NextAction
          brand={EBrand.GitHub}
          title="Connect GitHub"
          description="Let agents clone, branch, and open pull requests."
          action="Connect"
          href={AUTH_PATHS.integrations}
        />
        <CopyRow label="Install the terminal app" command={AUTH_INSTALL_COMMAND} />
        <CopyRow label="Then sign in from your terminal" command={AUTH_LOGIN_COMMAND} />
      </div>
      <LinkButton href={AUTH_PATHS.newThread}>
        Open Atlas Cloud
        <ExternalLink data-icon="inline-end" />
      </LinkButton>
    </div>
  )
}
