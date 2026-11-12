import {
  composePlugins,
  definePlugin,
  EMPTY_CONTROL,
  EMPTY_POD,
  type Plugin,
  type PluginPodContext,
} from '@dltech/atlas-plugin-sdk'
import { githubControl } from '@dltech/atlas-plugin-github/control'
import { githubCoreSlots } from '@dltech/atlas-plugin-github/core'
import { githubPod } from '@dltech/atlas-plugin-github/pod'
import { mcpClient } from '@dltech/atlas-plugin-mcp/client'
import { mcpControl } from '@dltech/atlas-plugin-mcp/control'
import { mcpCoreSlots } from '@dltech/atlas-plugin-mcp/core'
import { mcpPod } from '@dltech/atlas-plugin-mcp/pod'
import { operatorClient } from '@dltech/atlas-plugin-operator/client'
import { operatorControl } from '@dltech/atlas-plugin-operator/control'
import { operatorCoreSlots } from '@dltech/atlas-plugin-operator/core'
import { operatorPod } from '@dltech/atlas-plugin-operator/pod'
import { mcpServerPort } from './config/mcp-servers'
import { skillCloudPort } from './config/skills'
import { skillsPodOf } from '@dltech/atlas-plugin-skills/pod'
import { memoryClient } from '@dltech/atlas-plugin-memory/client'
import { memoryControl } from '@dltech/atlas-plugin-memory/control'
import { memoryCoreSlots } from '@dltech/atlas-plugin-memory/core'
import { memoryPod } from '@dltech/atlas-plugin-memory/pod'
import { servicesClient } from '@dltech/atlas-plugin-services/client'
import { servicesControl } from '@dltech/atlas-plugin-services/control'
import { servicesCoreSlots } from '@dltech/atlas-plugin-services/core'
import { servicesPod } from '@dltech/atlas-plugin-services/pod'
import { crewClient } from '@dltech/atlas-plugin-crew/client'
import { crewControl } from '@dltech/atlas-plugin-crew/control'
import { crewCoreSlots } from '@dltech/atlas-plugin-crew/core'
import { crewPod } from '@dltech/atlas-plugin-crew/pod'
import { shellsClient } from '@dltech/atlas-plugin-shells/client'
import { shellsControl } from '@dltech/atlas-plugin-shells/control'
import { shellsCoreSlots } from '@dltech/atlas-plugin-shells/core'
import { shellsPod } from '@dltech/atlas-plugin-shells/pod'
import { sessionsControl } from '@dltech/atlas-plugin-sessions/control'
import { sessionsCoreSlots } from '@dltech/atlas-plugin-sessions/core'
import { sessionsPod } from '@dltech/atlas-plugin-sessions/pod'
import { webClient } from '@dltech/atlas-plugin-web/client'
import { webControl } from '@dltech/atlas-plugin-web/control'
import { webCoreSlots } from '@dltech/atlas-plugin-web/core'
import { webPod } from '@dltech/atlas-plugin-web/pod'

const skillCloud = skillCloudPort()

const skillsPodFor = (ctx: PluginPodContext) =>
  skillsPodOf({
    cloud: skillCloud.source(ctx.sessionId),
    writes: skillCloud.writer(ctx.sessionId),
  })

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
    name: 'memory',
    ...memoryCoreSlots,
    pod: memoryPod,
    control: memoryControl,
    client: memoryClient,
    transport: 'none',
  }),
  definePlugin({
    name: 'crew',
    ...crewCoreSlots,
    pod: crewPod,
    control: crewControl,
    client: crewClient,
    transport: 'none',
  }),
  definePlugin({
    name: 'services',
    ...servicesCoreSlots,
    pod: servicesPod,
    control: servicesControl,
    client: servicesClient,
    transport: 'stream',
  }),
  definePlugin({
    name: 'mcp',
    ...mcpCoreSlots,
    pod: mcpPod({ config: mcpServerPort() }),
    control: mcpControl,
    client: mcpClient,
    transport: 'stream',
  }),
  definePlugin({
    name: 'operator',
    ...operatorCoreSlots,
    pod: operatorPod,
    control: operatorControl,
    client: operatorClient,
    transport: 'none',
  }),
  definePlugin({
    name: 'skills',
    events: [],
    views: [],
    commands: [],
    pod: {
      ...EMPTY_POD,
      tools: (ctx) => skillsPodFor(ctx).tools?.(ctx) ?? [],
      hooks: (ctx) => skillsPodFor(ctx).hooks?.(ctx) ?? {},
    },
    control: EMPTY_CONTROL,
    client: { hooks: [] },
    transport: 'none',
  }),
  definePlugin({
    name: 'sessions',
    ...sessionsCoreSlots,
    pod: sessionsPod,
    control: sessionsControl,
    client: { hooks: [] },
    transport: 'none',
  }),
  definePlugin({
    name: 'web',
    ...webCoreSlots,
    pod: webPod,
    control: webControl,
    client: webClient,
    transport: 'none',
  }),
]

export const composedPlugins = composePlugins(registeredPlugins)
