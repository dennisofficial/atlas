import type { SandboxListing } from '../sandbox-provider'
import { isAgent37Missing, type Agent37Client, type Agent37Instance } from './agent37-client'
import { AGENT37_POD_SESSION_KEY, type Agent37InstanceIds } from './agent37-instances'

const pagesOf = async (client: Agent37Client): Promise<Agent37Instance[]> => {
  const instances: Agent37Instance[] = []
  let cursor: string | undefined
  for (;;) {
    const page = await client.list(cursor === undefined ? {} : { cursor })
    instances.push(...page.data)
    if (page.next === undefined) return instances
    cursor = page.next
  }
}

const attributedInstanceIdsOf = async (args: {
  client: Agent37Client
  podSessionId: string
}): Promise<string[]> =>
  (await pagesOf(args.client))
    .filter((instance) => instance.metadata?.[AGENT37_POD_SESSION_KEY] === args.podSessionId)
    .map((instance) => instance.id)

export const listAgent37Instances = async (args: {
  client: Agent37Client
  log?: ((line: string) => void) | undefined
}): Promise<readonly SandboxListing[]> => {
  const listings: SandboxListing[] = []
  const unattributed: string[] = []
  for (const instance of await pagesOf(args.client)) {
    const sandboxSessionId = instance.metadata?.[AGENT37_POD_SESSION_KEY]
    if (sandboxSessionId === undefined) {
      unattributed.push(instance.id)
      continue
    }
    listings.push({
      sandboxSessionId,
      running: instance.status === 'running',
      createdAt: (instance.created ?? 0) * 1000,
    })
  }
  if (unattributed.length > 0) {
    args.log?.(
      `agent37: ${unattributed.length} instances carry no pod session id, so no sweep can attribute or delete them: ${unattributed.join(', ')}`,
    )
  }
  return listings
}

export const sleepAgent37Pod = async (args: {
  client: Agent37Client
  instances: Agent37InstanceIds
  podSessionId: string
}): Promise<void> => {
  const known = await args.instances.find({ podSessionId: args.podSessionId })
  const attributed = await attributedInstanceIdsOf({
    client: args.client,
    podSessionId: args.podSessionId,
  })
  const ids = new Set([...(known === null ? [] : [known]), ...attributed])
  for (const id of ids) await args.client.sleep({ id })
}

export const removeAgent37Pod = async (args: {
  client: Agent37Client
  instances: Agent37InstanceIds
  podSessionId: string
  log?: ((line: string) => void) | undefined
}): Promise<void> => {
  const attributed = await attributedInstanceIdsOf({
    client: args.client,
    podSessionId: args.podSessionId,
  })
  const known = await args.instances.find({ podSessionId: args.podSessionId })
  let leftAlone = known !== null && !attributed.includes(known)
  if (leftAlone) {
    args.log?.(
      `agent37: instance ${known} carries no pod session id for ${args.podSessionId}, so the sweep never deletes it`,
    )
  }
  for (const instanceId of attributed) {
    try {
      // A running instance has someone behind it; the sweep stops it on one pass and deletes it
      // on a later one, so a pod that came alive is never deleted under its user.
      if ((await args.client.get({ id: instanceId })).status === 'running') {
        leftAlone = true
        continue
      }
      await args.client.remove({ id: instanceId })
    } catch (failure) {
      if (!isAgent37Missing(failure)) throw failure
    }
  }
  if (!leftAlone) await args.instances.forget({ podSessionId: args.podSessionId })
}
