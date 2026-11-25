import { crewClient, crewCoreSlots } from '@dltech/atlas-plugin-crew/client'
import { githubClient } from '@dltech/atlas-plugin-github/client'
import { githubCoreSlots } from '@dltech/atlas-plugin-github/core'
import { mcpClient } from '@dltech/atlas-plugin-mcp/client'
import { mcpCoreSlots } from '@dltech/atlas-plugin-mcp/core'
import { operatorClient } from '@dltech/atlas-plugin-operator/client'
import { operatorCoreSlots } from '@dltech/atlas-plugin-operator/core'
import {
  definePlugin,
  EMPTY_CONTROL,
  EMPTY_POD,
  eventSchemaOf,
  eventTypesOf,
  type Plugin,
} from '@dltech/atlas-plugin-sdk'
import { servicesClient } from '@dltech/atlas-plugin-services/client'
import { servicesCoreSlots } from '@dltech/atlas-plugin-services/core'
import { sessionsCoreSlots } from '@dltech/atlas-plugin-sessions/core'
import { shellsClient, shellsCoreSlots } from '@dltech/atlas-plugin-shells/client'
import { skillsClient } from '@dltech/atlas-plugin-skills/client'
import { skillsCoreSlots } from '@dltech/atlas-plugin-skills/core'

const registeredPlugins: readonly Plugin[] = [
  definePlugin({
    name: 'crew',
    ...crewCoreSlots,
    pod: EMPTY_POD,
    control: EMPTY_CONTROL,
    client: crewClient,
    transport: 'none',
  }),
  definePlugin({
    name: 'github',
    ...githubCoreSlots,
    pod: EMPTY_POD,
    control: EMPTY_CONTROL,
    client: githubClient,
    transport: 'stream',
  }),
  definePlugin({
    name: 'mcp',
    ...mcpCoreSlots,
    pod: EMPTY_POD,
    control: EMPTY_CONTROL,
    client: mcpClient,
    transport: 'stream',
  }),
  definePlugin({
    name: 'operator',
    ...operatorCoreSlots,
    pod: EMPTY_POD,
    control: EMPTY_CONTROL,
    client: operatorClient,
    transport: 'none',
  }),
  definePlugin({
    name: 'services',
    ...servicesCoreSlots,
    pod: EMPTY_POD,
    control: EMPTY_CONTROL,
    client: servicesClient,
    transport: 'stream',
  }),
  definePlugin({
    name: 'sessions',
    ...sessionsCoreSlots,
    pod: EMPTY_POD,
    control: EMPTY_CONTROL,
    client: { hooks: [] },
    transport: 'none',
  }),
  definePlugin({
    name: 'shells',
    ...shellsCoreSlots,
    pod: EMPTY_POD,
    control: EMPTY_CONTROL,
    client: shellsClient,
    transport: 'stream',
  }),
  definePlugin({
    name: 'skills',
    ...skillsCoreSlots,
    pod: EMPTY_POD,
    control: EMPTY_CONTROL,
    client: skillsClient,
    transport: 'stream',
  }),
]

export const eventSchema = eventSchemaOf(registeredPlugins)

export const eventTypes: ReadonlySet<string> = new Set(eventTypesOf(registeredPlugins))

export const views = registeredPlugins.flatMap((plugin) => plugin.views)
