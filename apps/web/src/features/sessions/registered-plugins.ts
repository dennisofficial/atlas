import {
  eventSchemaOf,
  eventTypesOf,
  definePlugin,
  EMPTY_CONTROL,
  EMPTY_POD,
  type Plugin,
} from '@dltech/atlas-plugin-sdk'
import { githubClient } from '@dltech/atlas-plugin-github/client'
import { githubCoreSlots } from '@dltech/atlas-plugin-github/core'
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
    name: 'shells',
    ...shellsCoreSlots,
    pod: EMPTY_POD,
    control: EMPTY_CONTROL,
    client: shellsClient,
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
