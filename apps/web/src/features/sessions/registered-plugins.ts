import {
  eventSchemaOf,
  eventTypesOf,
  definePlugin,
  EMPTY_CONTROL,
  EMPTY_POD,
  type Plugin,
} from '@dltech/atlas-plugin-sdk'
import { crewClient, crewCoreSlots } from '@dltech/atlas-plugin-crew/client'
import { githubClient } from '@dltech/atlas-plugin-github/client'
import { githubCoreSlots } from '@dltech/atlas-plugin-github/core'
import { mcpClient } from '@dltech/atlas-plugin-mcp/client'
import { mcpCoreSlots } from '@dltech/atlas-plugin-mcp/core'
import { servicesClient } from '@dltech/atlas-plugin-services/client'
import { servicesCoreSlots } from '@dltech/atlas-plugin-services/core'
import { shellsClient, shellsCoreSlots } from '@dltech/atlas-plugin-shells/client'

const registeredPlugins: readonly Plugin[] = [
  definePlugin({
    name: 'github',
    ...githubCoreSlots,
    pod: EMPTY_POD,
    control: EMPTY_CONTROL,
    client: githubClient,
    transport: 'stream',
  }),
  definePlugin({
    name: 'crew',
    ...crewCoreSlots,
    pod: EMPTY_POD,
    control: EMPTY_CONTROL,
    client: crewClient,
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
    name: 'mcp',
    ...mcpCoreSlots,
    pod: EMPTY_POD,
    control: EMPTY_CONTROL,
    client: mcpClient,
    transport: 'stream',
  }),
  definePlugin({
    name: 'services',
    ...servicesCoreSlots,
    pod: EMPTY_POD,
    control: EMPTY_CONTROL,
    client: servicesClient,
    transport: 'stream',
  }),
]

export const sessionEventSchema = eventSchemaOf(registeredPlugins)

export const sessionEventTypes: ReadonlySet<string> = new Set(eventTypesOf(registeredPlugins))
