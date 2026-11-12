import { composePlugins, definePlugin, EMPTY_POD, type Plugin } from '@dltech/atlas-plugin-sdk'
import { githubControl } from '@dltech/atlas-plugin-github/control'
import { crewControl } from '@dltech/atlas-plugin-crew/control'
import { crewCoreSlots } from '@dltech/atlas-plugin-crew/core'
import { githubCoreSlots } from '@dltech/atlas-plugin-github/core'
import { mcpClient } from '@dltech/atlas-plugin-mcp/client'
import { mcpControl } from '@dltech/atlas-plugin-mcp/control'
import { mcpCoreSlots } from '@dltech/atlas-plugin-mcp/core'
import { operatorClient } from '@dltech/atlas-plugin-operator/client'
import { operatorControl } from '@dltech/atlas-plugin-operator/control'
import { operatorCoreSlots } from '@dltech/atlas-plugin-operator/core'
import { servicesClient } from '@dltech/atlas-plugin-services/client'
import { sessionsControl } from '@dltech/atlas-plugin-sessions/control'
import { sessionsCoreSlots } from '@dltech/atlas-plugin-sessions/core'
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
    name: 'crew',
    ...crewCoreSlots,
    pod: EMPTY_POD,
    control: crewControl,
    client: { hooks: [] },
    transport: 'none',
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
  definePlugin({
    name: 'mcp',
    ...mcpCoreSlots,
    pod: EMPTY_POD,
    control: mcpControl,
    client: mcpClient,
    transport: 'stream',
  }),
  definePlugin({
    name: 'operator',
    ...operatorCoreSlots,
    pod: EMPTY_POD,
    control: operatorControl,
    client: operatorClient,
    transport: 'none',
  }),
  definePlugin({
    name: 'sessions',
    ...sessionsCoreSlots,
    pod: EMPTY_POD,
    control: sessionsControl,
    client: { hooks: [] },
    transport: 'none',
  }),
]

export const composedPlugins = composePlugins(registeredPlugins)
