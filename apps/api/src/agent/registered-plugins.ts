import {
  composePlugins,
  definePlugin,
  EMPTY_CONTROL,
  eventSchemaOf,
  type ComposedPlugins,
  type Plugin,
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
import { instructionsCoreSlots } from '@dltech/atlas-plugin-instructions/core'
import { instructionsPodOf } from '@dltech/atlas-plugin-instructions/pod'
import { qualityPodOf } from '@dltech/atlas-plugin-quality/pod'
import { mcpServerPort } from './config/mcp-servers'
import { skillCloudPort } from './config/skills'
import { instructionsPort } from './config/instructions'
import { qualitySettingsPort } from './config/quality-settings'
import type { AgentHostEnv } from './config/env'
import { skillsClient } from '@dltech/atlas-plugin-skills/client'
import { skillsCoreSlots } from '@dltech/atlas-plugin-skills/core'
import { skillsPodOf } from '@dltech/atlas-plugin-skills/pod'
import { memoryClient } from '@dltech/atlas-plugin-memory/client'
import { memoryControl } from '@dltech/atlas-plugin-memory/control'
import { memoryCoreSlots } from '@dltech/atlas-plugin-memory/core'
import { memoryPod } from '@dltech/atlas-plugin-memory/pod'
import { routinesClient } from '@dltech/atlas-plugin-routines/client'
import { routinesControl } from '@dltech/atlas-plugin-routines/control'
import { routinesCoreSlots } from '@dltech/atlas-plugin-routines/core'
import { routinesPod } from '@dltech/atlas-plugin-routines/pod'
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
import { imagesClient } from '@dltech/atlas-plugin-images/client'
import { imagesControl } from '@dltech/atlas-plugin-images/control'
import { imagesCoreSlots } from '@dltech/atlas-plugin-images/core'
import { imagesPod } from '@dltech/atlas-plugin-images/pod'
import { sessionsControl } from '@dltech/atlas-plugin-sessions/control'
import { sessionsCoreSlots } from '@dltech/atlas-plugin-sessions/core'
import { sessionsPod } from '@dltech/atlas-plugin-sessions/pod'
import { webClient } from '@dltech/atlas-plugin-web/client'
import { webControl } from '@dltech/atlas-plugin-web/control'
import { webCoreSlots } from '@dltech/atlas-plugin-web/core'
import { webPodOf } from '@dltech/atlas-plugin-web/pod'

const skillCloud = skillCloudPort()

const personalInstructions = instructionsPort()

const instructionsPod = instructionsPodOf({
  personal: async (ctx) => await personalInstructions.personal(ctx.sessionId),
  group: async (ctx) => await personalInstructions.group(ctx.sessionId),
})

const skillsPod = skillsPodOf({
  cloud: (ctx) => skillCloud.source(ctx.sessionId),
  writes: (ctx) => skillCloud.writer(ctx.sessionId),
  suggests: async (ctx) => await skillCloud.suggests(ctx.sessionId),
})

const qualitySettings = qualitySettingsPort()

const qualityPod = qualityPodOf({
  settings: async (ctx) => await qualitySettings.settings(ctx.sessionId),
})

export type PluginHostEnv = Pick<AgentHostEnv, 'jinaApiKey'>

const pluginsOf = (env: PluginHostEnv): readonly Plugin[] => [
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
    name: 'routines',
    ...routinesCoreSlots,
    pod: routinesPod,
    control: routinesControl,
    client: routinesClient,
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
    name: 'instructions',
    ...instructionsCoreSlots,
    pod: instructionsPod,
    control: EMPTY_CONTROL,
    client: { hooks: [] },
    transport: 'none',
  }),
  definePlugin({
    name: 'skills',
    ...skillsCoreSlots,
    pod: skillsPod,
    control: EMPTY_CONTROL,
    client: skillsClient,
    transport: 'stream',
  }),
  definePlugin({
    name: 'quality',
    events: [],
    views: [],
    commands: [],
    pod: qualityPod,
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
    pod: webPodOf({ jinaKey: () => env.jinaApiKey }),
    control: webControl,
    client: webClient,
    transport: 'none',
  }),
  definePlugin({
    name: 'images',
    ...imagesCoreSlots,
    pod: imagesPod,
    control: imagesControl,
    client: imagesClient,
    transport: 'none',
  }),
]

export const composedPluginsOf = (env: PluginHostEnv): ComposedPlugins =>
  composePlugins(pluginsOf(env))

export const registeredPlugins = pluginsOf({ jinaApiKey: undefined })

export const controlEventSchema = eventSchemaOf(registeredPlugins)
