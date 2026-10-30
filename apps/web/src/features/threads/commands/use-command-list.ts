import { useCallback, useEffect, useState } from 'react'

import { ECommandGroup, ECommandKind, type CommandSpec } from '@dltech/atlas-core'
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

const NO_SKILLS: readonly CommandSpec[] = []

export const skillSpecsOf = (reply: ListCommandsReply): readonly CommandSpec[] =>
  reply.skills.map((skill) => ({
    name: skill.name,
    aliases: skill.aliases,
    kind: ECommandKind.Skill,
    summary: skill.summary,
    group: ECommandGroup.Workspace,
    argumentHint: skill.argumentHint,
  }))

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

export function useCommandList(args: { channel: RemoteDeltaChannel | null; live: boolean }) {
  const [skills, setSkills] = useState<readonly CommandSpec[]>(NO_SKILLS)
  const { channel, live } = args

  useEffect(() => {
    if (!live) return
    let current = true
    fetchSkillSpecs({ channel, reload: false })
      .then((found) => {
        if (current && found !== null) setSkills(found)
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [channel, live])

  const reload = useCallback(async (): Promise<number | null> => {
    const found = await fetchSkillSpecs({ channel, reload: true })
    if (found === null) return null
    setSkills(found)
    return found.length
  }, [channel])

  return { skills, reload }
}
