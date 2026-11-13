'use client'

import { TriangleAlertIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { Alert, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'
import { Button } from '@dltech/atlas-ui/components/button'

import { providerNameOf } from '@/features/threads/data/model-options'
import { PROVIDERS_HREF } from '../../settings-nav'
import {
  affectedOf,
  ownsModel,
  type RoleChoices,
  type StaleOwner,
} from '../../data/personal/model-roles'
import { sentenceSubjectOf, signInNameOf } from './role-copy'

const CONNECT_AGAIN = "They'll run again once a key is back."

const affectedLineOf = ({
  owner,
  choices,
}: {
  owner: StaleOwner
  choices: RoleChoices
}): string => {
  const followers = affectedOf({ choices, role: owner.role })
  if (followers === 0) return `${sentenceSubjectOf(owner.role)} stops running until this is fixed.`
  if (ownsModel(owner.choice) && sentenceSubjectOf(owner.role) === 'The main agent') {
    return 'The main agent and everything that follows it are affected.'
  }
  return `${sentenceSubjectOf(owner.role)} and ${followers} other ${followers === 1 ? 'role' : 'roles'} are affected.`
}

export function ProviderAlert({
  owner,
  choices,
  label,
  expired,
  onChoose,
}: {
  owner: StaleOwner
  choices: RoleChoices
  label: string
  expired: boolean
  onChoose: () => void
}) {
  const router = useRouter()
  const provider = providerNameOf(owner.choice.ref.providerId)
  const affected = affectedLineOf({ owner, choices })
  const handleProviders = () => router.push(PROVIDERS_HREF)
  const title = expired
    ? `Your ${signInNameOf(provider)} sign-in expired`
    : `${label} can't run: ${provider} isn't connected`
  const description = expired
    ? `${label} stops running until you reconnect. ${affected}`
    : `${affected} ${CONNECT_AGAIN}`
  return (
    <Alert>
      <TriangleAlertIcon aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
      <div className="col-start-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={handleProviders}>
          {expired ? 'Reconnect' : `Connect ${provider}`}
        </Button>
        <Button size="sm" variant="ghost" onClick={onChoose}>
          Choose another model
        </Button>
      </div>
    </Alert>
  )
}
