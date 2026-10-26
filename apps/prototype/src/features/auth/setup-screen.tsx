import { ArrowRight, Check, Copy, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { FieldGroup } from '@dltech/atlas-ui/components/field'
import { BrandMark, EBrand } from '@dltech/atlas-ui/components/brand-mark'

import { LinkButton, SubmitButton } from './auth-controls'
import { AuthField } from './auth-field'
import { slugify } from './auth-format'
import { AuthHeading } from './auth-heading'
import { AUTH_PATHS, withState } from './auth-paths'
import { ESetupState } from './auth-states'
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

export function SetupScreen({ state }: { state: ESetupState }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const slug = slugify(name)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    router.push(withState({ path: AUTH_PATHS.setup, state: ESetupState.Done }))
  }

  if (state === ESetupState.Done) {
    return (
      <div className="flex flex-col gap-6">
        <AuthHeading
          title="You're set"
          description="Your workspace is ready. Pick up where you like."
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

  return (
    <div className="flex flex-col gap-6">
      <AuthHeading
        title="Name your workspace"
        description="A workspace holds your threads, repos, and teammates. You can rename it later."
      />
      <form onSubmit={handleSubmit}>
        <FieldGroup className="gap-4">
          <AuthField
            id="workspace"
            label="Workspace name"
            placeholder="Analytical Engines"
            value={name}
            onChange={setName}
            autoFocus
            description={
              <span className="font-mono text-xs">
                atlas.byatlas.io/<span className="text-foreground">{slug || 'your-workspace'}</span>
              </span>
            }
          />
          <SubmitButton disabled={slug.length === 0}>
            Create workspace
            <ArrowRight data-icon="inline-end" />
          </SubmitButton>
        </FieldGroup>
      </form>
    </div>
  )
}
