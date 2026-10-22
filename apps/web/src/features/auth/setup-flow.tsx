'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'

import { FieldGroup } from '@dltech/atlas-ui/components/field'

import { sessionUserPresent } from '@/lib/auth-api'
import {
  activeOrganizationId,
  createOrganization,
  listOrganizations,
  OrganizationApiError,
  setActiveOrganization,
} from '@/lib/organization-api'
import { workspaceSlug } from '@/lib/workspace-slug'
import { ArrowRight } from 'lucide-react'

import { FormError, SubmitButton } from './auth-controls'
import { AuthField } from './auth-field'
import { AuthHeading } from './auth-heading'
import { PageSpinner } from './page-spinner'
import { SetupDone } from './setup-done'

enum ESetupStep {
  Checking = 'checking',
  Workspace = 'workspace',
  Done = 'done',
}

const SIGN_IN_FOR_SETUP = '/sign-in?next=%2Fsetup'

export function SetupFlow() {
  const router = useRouter()
  const [step, setStep] = useState(ESetupStep.Checking)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const slug = workspaceSlug(name)

  useEffect(() => {
    let cancelled = false

    const check = async () => {
      if (!(await sessionUserPresent().catch(() => false))) {
        router.replace(SIGN_IN_FOR_SETUP)
        return
      }
      const organizations = await listOrganizations().catch(() => [])
      const first = organizations[0]
      if (first !== undefined) {
        if ((await activeOrganizationId().catch(() => null)) === null) {
          await setActiveOrganization({ organizationId: first.id }).catch(() => undefined)
        }
        if (!cancelled) router.replace('/threads/new')
        return
      }
      if (!cancelled) setStep(ESetupStep.Workspace)
    }

    void check()
    return () => {
      cancelled = true
    }
  }, [router])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const organizationId = await createOrganization({ name: name.trim(), slug })
      await setActiveOrganization({ organizationId })
      setStep(ESetupStep.Done)
    } catch (cause) {
      setError(cause instanceof OrganizationApiError ? cause.message : 'Could not create the workspace')
      setBusy(false)
    }
  }

  if (step === ESetupStep.Checking) return <PageSpinner label="Loading…" />
  if (step === ESetupStep.Done) return <SetupDone />

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
            disabled={busy}
            autoFocus
            description={
              <span className="font-mono text-xs">
                Slug: <span className="text-foreground">{slug || 'your-workspace'}</span>
              </span>
            }
          />
          {error !== null && <FormError>{error}</FormError>}
          <SubmitButton busy={busy} disabled={slug.length === 0}>
            Create workspace
            <ArrowRight data-icon="inline-end" />
          </SubmitButton>
        </FieldGroup>
      </form>
    </div>
  )
}
