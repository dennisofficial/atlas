import { composePlugins, definePlugin, EMPTY_POD, type Plugin } from '@dltech/atlas-plugin-sdk'
import { githubControl } from '@dltech/atlas-plugin-github/control'
import { githubCoreSlots } from '@dltech/atlas-plugin-github/core'
import { servicesClient } from '@dltech/atlas-plugin-services/client'
import { servicesControl } from '@dltech/atlas-plugin-services/control'
import { servicesCoreSlots } from '@dltech/atlas-plugin-services/core'
import { shellsClient } from '@dltech/atlas-plugin-shells/client'
import { shellsControl } from '@dltech/atlas-plugin-shells/control'
import { shellsCoreSlots } from '@dltech/atlas-plugin-shells/core'

export const registeredPlugins: readonly Plugin[] = [
  definePlugin({
    name: 'github',
    ...githubCoreSlots,
    pod: EMPTY_POD,
    control: githubControl,
    client: { hooks: [] },
    transport: 'stream',
  }),
  definePlugin({
    name: 'shells',
    ...shellsCoreSlots,
    pod: EMPTY_POD,
    control: shellsControl,
    client: shellsClient,
    transport: 'stream',
  }),
  definePlugin({
    name: 'services',
    ...servicesCoreSlots,
    pod: EMPTY_POD,
    control: servicesControl,
    client: servicesClient,
    transport: 'stream',
  }),
]

export const composedPlugins = composePlugins(registeredPlugins)
