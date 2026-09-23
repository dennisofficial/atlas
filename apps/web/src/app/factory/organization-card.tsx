'use client'

import { Badge } from '@dltech/atlas-ui/badge'
import { Button } from '@dltech/atlas-ui/button'
import { Card } from '@dltech/atlas-ui/card'
import { Input } from '@dltech/atlas-ui/input'
import { useState, type FormEvent } from 'react'

import {
  createOrganization,
  setActiveOrganization,
  type Organization,
} from '../../lib/organization-api'

type OrganizationCardProps = {
  organizations: Organization[]
  activeOrganizationId: string | null
  onChanged: () => Promise<void>
}

export function OrganizationCard({
  organizations,
  activeOrganizationId,
  onChanged,
}: OrganizationCardProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  const handleSwitch = (organizationId: string) =>
    run(() => setActiveOrganization({ organizationId }))

  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('org-name') ?? '').trim()
    const slug = String(form.get('org-slug') ?? '').trim()
    event.currentTarget.reset()
    void run(() => createOrganization({ name, slug }))
  }

  return (
    <Card
      title="Organization"
      subtitle="Factory work happens inside the active organization"
    >
      <div className="flex flex-col gap-4">
        {organizations.length === 0 ? (
          <p className="text-sm text-meta">You do not belong to an organization yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {organizations.map((organization) => (
              <li key={organization.id} className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-sm text-foreground">{organization.name}</span>
                  <span className="font-mono text-xs text-hint">{organization.slug}</span>
                </div>
                {organization.id === activeOrganizationId ? (
                  <Badge tone="success" dot>
                    active
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void handleSwitch(organization.id)}
                  >
                    Switch
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={handleCreate} className="flex flex-col gap-3 border-t border-border pt-4">
          <Input name="org-name" label="New organization name" placeholder="Acme Inc" required />
          <Input name="org-slug" label="Slug" placeholder="acme" required />
          {error !== null ? <p className="text-xs text-destructive">{error}</p> : null}
          <Button type="submit" variant="primary" loading={busy}>
            Create organization
          </Button>
        </form>
      </div>
    </Card>
  )
}
