import { composePlugins, definePlugin, type Plugin } from '@dltech/atlas-plugin-sdk'
import { githubControl } from '@dltech/atlas-plugin-github/control'
import { githubCoreSlots } from '@dltech/atlas-plugin-github/core'
import { githubPod } from '@dltech/atlas-plugin-github/pod'
import { servicesClient } from '@dltech/atlas-plugin-services/client'
import { servicesControl } from '@dltech/atlas-plugin-services/control'
import { servicesCoreSlots } from '@dltech/atlas-plugin-services/core'
import { servicesPod } from '@dltech/atlas-plugin-services/pod'
import { shellsClient } from '@dltech/atlas-plugin-shells/client'
import { shellsControl } from '@dltech/atlas-plugin-shells/control'
import { shellsCoreSlots } from '@dltech/atlas-plugin-shells/core'
import { shellsPod } from '@dltech/atlas-plugin-shells/pod'

export const registeredPlugins: readonly Plugin[] = [
  definePlugin({
    name: 'github',
    ...githubCoreSlots,
    pod: githubPod,
    control: githubControl,
    client: { hooks: [] },
    transport: 'stream',
  }),
  definePlugin({
    name: 'shells',
    ...shellsCoreSlots,
    pod: shellsPod,
    control: shellsControl,
    client: shellsClient,
    transport: 'stream',
  }),
  definePlugin({
    name: 'services',
    ...servicesCoreSlots,
    pod: servicesPod,
    control: servicesControl,
    client: servicesClient,
    transport: 'stream',
  }),
]

export const composedPlugins = composePlugins(registeredPlugins)
