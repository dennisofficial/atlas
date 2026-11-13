'use client'

import { EModelRole } from '@dltech/atlas-core'
import { TriangleAlertIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { Alert, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'
import { Button } from '@dltech/atlas-ui/components/button'

import { providerNameOf } from '@/features/threads/data/model-options'
import { PROVIDERS_HREF } from '../../settings-nav'
import { affectedOf, type RoleChoices, type StaleOwner } from '../../data/personal/model-roles'
import { sentenceSubjectOf, signInNameOf } from './role-copy'

const isMainOf = (owner: StaleOwner): boolean => owner.role === EModelRole.Main

const followsNoteOf = ({ owner, choices }: { owner: StaleOwner; choices: RoleChoices }): string => {
  if (!isMainOf(owner)) return ''
  const followers = affectedOf({ choices, role: owner.role })
  return followers === 0 ? '' : ' Everything that follows the main agent is affected too.'
}

const titleOf = (args: {
  owner: StaleOwner
  label: string
  provider: string
  expired: boolean
}): string => {
  if (args.expired) return `Your ${signInNameOf(args.provider)} sign-in expired`
  if (isMainOf(args.owner)) return `${args.label} can't run: ${args.provider} isn't connected`
  return `${sentenceSubjectOf(args.owner.role)} is running on the main agent's model`
}

const descriptionOf = (args: {
  owner: StaleOwner
  choices: RoleChoices
  provider: string
  expired: boolean
}): string => {
  const note = followsNoteOf({ owner: args.owner, choices: args.choices })
  if (isMainOf(args.owner)) {
    return args.expired
      ? `New threads won't start until you reconnect.${note}`
      : `New threads won't start until you connect ${args.provider} or pick another model.${note}`
  }
  const subject = sentenceSubjectOf(args.owner.role)
  return args.expired
    ? `${subject} switches to the main agent's model until you reconnect.`
    : `${args.provider} isn't connected, so ${subject} uses the main agent's model until you connect it or pick another model.`
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
  const handleProviders = () => router.push(PROVIDERS_HREF)
  const title = titleOf({ owner, label, provider, expired })
  const description = descriptionOf({ owner, choices, provider, expired })
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
