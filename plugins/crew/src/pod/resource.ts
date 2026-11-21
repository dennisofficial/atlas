import { join } from 'node:path'

import { readResource, type PluginPodContext, type PodResource } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { discoverRepoAgentTypes, REPO_AGENT_ROOTS, type RepoAgentTypes } from './repo-agent-types'

export const CREW_AGENT_TYPES_RESOURCE = 'crew-agent-types'

export const repoAgentTypesSchema: z.ZodType<RepoAgentTypes> = z.object({
  types: z.array(
    z.object({
      name: z.string(),
      whenToUse: z.string(),
      prompt: z.string(),
      definedIn: z.string(),
    }),
  ),
  refusals: z.array(z.object({ name: z.string(), definedIn: z.string(), reason: z.string() })),
})

export const repoAgentTypesResource: PodResource<RepoAgentTypes> = {
  name: CREW_AGENT_TYPES_RESOURCE,
  schema: repoAgentTypesSchema,
  watch: (directory) => ({ roots: REPO_AGENT_ROOTS.map((root) => join(directory, root)) }),
  load: async ({ ctx, directory, signal }) =>
    await discoverRepoAgentTypes({ ctx, projectDirectory: directory, signal }),
}

export const repoAgentTypesOf = (
  ctx: Pick<PluginPodContext, 'events'>,
): RepoAgentTypes | undefined => readResource({ ctx, resource: repoAgentTypesResource })
