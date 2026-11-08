import {
  eventSchemaOf,
  definePlugin,
  EMPTY_CONTROL,
  EMPTY_POD,
  type Plugin,
} from '@dltech/atlas-plugin-sdk'
import { githubClient } from '@dltech/atlas-plugin-github/client'
import { githubCoreSlots } from '@dltech/atlas-plugin-github/core'

const registeredPlugins: readonly Plugin[] = [
  definePlugin({
    name: 'github',
    ...githubCoreSlots,
    pod: EMPTY_POD,
    control: EMPTY_CONTROL,
    client: githubClient,
    transport: 'stream',
  }),
]

export const sessionEventSchema = eventSchemaOf(registeredPlugins)
