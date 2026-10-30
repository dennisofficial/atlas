import { useCallback, useEffect, useMemo, useState } from 'react'

import type { CommandSpec } from '@dltech/atlas-core'
import {
  EClientRequest,
  EConnectionView,
  type RemoteDeltaChannel,
} from '@dltech/atlas-client/channel'
import {
  ECapability,
  listCommandsReplySchema,
  type ListCommandsReply,
} from '@dltech/atlas-wire/web'

import { mergeSkillSpecs, skillSpecOf } from './skill-specs'
import { useCatalogueSkills } from './use-catalogue-skills'

const NO_SKILLS: readonly CommandSpec[] = []

export const skillSpecsOf = (reply: ListCommandsReply): readonly CommandSpec[] =>
  reply.skills.map(skillSpecOf)

export const fetchSkillSpecs = async (args: {
  channel: RemoteDeltaChannel | null
  reload: boolean
}): Promise<readonly CommandSpec[] | null> => {
  const { channel } = args
  if (channel === null) return null
  if (channel.connection().state !== EConnectionView.Connected) return null
  if (!channel.capabilities().has(ECapability.CommandList)) return null
  const reply = await channel.request({
    op: EClientRequest.ListCommands,
    params: args.reload ? { reload: true } : {},
  })
  return skillSpecsOf(listCommandsReplySchema.parse(reply))
}

export function useCommandList(args: {
  channel: RemoteDeltaChannel | null
  live: boolean
  projectId: string | null | undefined
}) {
  const [sandboxSkills, setSandboxSkills] = useState<readonly CommandSpec[]>(NO_SKILLS)
  const catalogue = useCatalogueSkills(args.projectId)
  const { channel, live } = args

  useEffect(() => {
    if (!live) return
    let current = true
    fetchSkillSpecs({ channel, reload: false })
      .then((found) => {
        if (current && found !== null) setSandboxSkills(found)
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [channel, live])

  const skills = useMemo(
    () => mergeSkillSpecs({ catalogue: catalogue.skills, sandbox: sandboxSkills }),
    [catalogue.skills, sandboxSkills],
  )

  const { reload: reloadCatalogue } = catalogue
  const reload = useCallback(async (): Promise<number> => {
    const [sandbox, fromCatalogue] = await Promise.all([
      fetchSkillSpecs({ channel, reload: true }),
      reloadCatalogue(),
    ])
    if (sandbox !== null) setSandboxSkills(sandbox)
    return mergeSkillSpecs({ catalogue: fromCatalogue, sandbox: sandbox ?? NO_SKILLS }).length
  }, [channel, reloadCatalogue])

  return { skills, reload }
}
