import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { ESandboxProvider } from '@dltech/atlas-protocol'
import { singleProviderRegistry } from './sandbox-registry'

import { composeCommands } from '@dltech/atlas-commands'
import { ControlPlane } from '@dltech/atlas-control'
import {
  nativeCommandHandlers,
  nativeCommands,
  nativeControlHandlers,
  resize,
} from '@dltech/atlas-native-commands'
import { composedPluginsOf, controlEventSchema } from '../registered-plugins'
import { gatedToolsOf, toolGateOf } from './gated-tools'
import { ERunFailureKind, ModelPort } from '@dltech/atlas-core'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { createDb, createPool } from '@dltech/atlas-db'
import { RandomIds } from '../runtime/random-ids'
import {
  SessionHolder,
  systemTimers,
  DRAIN_IN_FLIGHT_CAP_MS,
  type NotifyDispatch,
} from '@dltech/atlas-host'
import { createPgHostPresence } from '../presence/pg-host-presence'
import { startHostWatch, type HostWatch } from '../presence/pg-host-watch'
import { LogPort, logFieldsOf } from '@dltech/atlas-observability'
import type { ComposedPlugins } from '@dltech/atlas-plugin-sdk'
import { TurnFault } from '@dltech/atlas-agent'
import { ScriptedModel, type ScriptedModelStep } from '@dltech/atlas-agent/testing'

import { createHostBus } from '../bus/host-bus'
import { startPgWakeListener } from '../bus/pg-wake-listener'
import { createRedisLiveFrames } from '../bus/redis-live-frames'
import { createRedisPodCallBus } from '../bus/redis-pod-call-bus'
import type { ConfigSource } from '../config/agent-host-config'
import { fakeModelSourceOf } from './model-source'
import { recordingModelOf } from './model-requests'
import { routedModelOf, scriptRoutesOf } from './script-routing'
import { createSessionRuntimeFactory } from '../runtime/session-runtime-factory'
import { contextDirOf } from '../runtime/session-paths'
import { DiskContextContentStore } from './disk-context-content-store'
import { FixedEndpointSandboxProvider } from './fixed-endpoint-sandbox-provider'
import { faultedPlane, faultSandbox, hostFaultOf } from './host-faults'
import { podResizeViewHooksOf } from './rig-pod-resize'
import type { JobsProjectDispatcher } from '../../_core/ports/job-dispatcher'
import { podResizeHandlerOf } from '../../_lib/pod-resize/pod-resize-handler'

const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`${name} is unset`)
  return value
}

const numberEnv = (name: string, fallback: number): number => {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} is not a number: ${value}`)
  return parsed
}

const daemonUrls = (): Record<string, string> | undefined => {
  const raw = process.env.DAEMON_URLS
  if (raw === undefined || raw === '') return undefined
  return JSON.parse(raw) as Record<string, string>
}

class FirstChunkMarker extends ModelPort {
  private marked = false

  constructor(
    private readonly inner: ModelPort,
    private readonly path: string,
  ) {
    super()
  }

  get identity(): ModelPort['identity'] {
    return this.inner.identity
  }

  step: ModelPort['step'] = (args) => {
    const onChunk = args.onChunk
    return this.inner.step({
      ...args,
      onChunk: (chunk) => {
        if (!this.marked && chunk.type === 'text-delta') {
          this.marked = true
          writeFileSync(this.path, '1')
        }
        return onChunk?.(chunk) ?? chunk
      },
    })
  }
}

const withFirstChunkMarker = (model: ModelPort): ModelPort => {
  const path = process.env.FIRST_CHUNK_FILE
  if (path === undefined || path === '') return model
  return new FirstChunkMarker(model, path)
}

const recordModelOf = (args: { model: ModelPort; host: string; sessionId: string }): ModelPort => {
  const path = process.env.MODEL_REQUESTS_FILE
  if (path === undefined || path === '') return args.model
  return recordingModelOf({ inner: args.model, path, host: args.host, sessionId: args.sessionId })
}

const tapToolOutput = (liveFrames: ReturnType<typeof createRedisLiveFrames>): void => {
  const path = process.env.TOOL_OUTPUT_FILE
  if (path === undefined || path === '') return
  const live = liveFrames.live.bind(liveFrames)
  liveFrames.live = (args) => {
    if (args.frame.type === 'tool-output') appendFileSync(path, args.frame.text)
    return live(args)
  }
}

class JsonLog extends LogPort {
  record(entry: Parameters<LogPort['record']>[0]): void {
    console.log(JSON.stringify(entry))
  }
}

const testSource = (): ConfigSource => ({
  read: async () => {
    const model = { configured: false as const, gap: 'scripted model in test' }
    return {
      userId: 'user-1',
      projectId: 'proj-1',
      model,
      models: fakeModelSourceOf(model),
      classifier: { on: false, reason: 'no classifier model is set' },
      quality: { enabled: false, policies: {} },
      rotation: { autoRotateAtPercent: 85 },
      sandbox: {
        configured: true,
        provider: ESandboxProvider.Vercel,
        credentials: { provider: ESandboxProvider.Vercel, token: '', teamId: '', projectId: '' },
      },
      workspace: {
        remoteUrl: null,
        baseBranch: null,
        additionalRepos: [],
        setupScript: process.env.SETUP_SCRIPT ?? '',
      },
      skills: [],
    }
  },
  models: async () => fakeModelSourceOf({ configured: false, gap: 'scripted model in test' }),
})

const noPodResizeDispatcher: JobsProjectDispatcher = {
  dispatch: async () => ({ runId: 'test-host-process' }),
}

const notifyOf = () => {
  const path = process.env.NOTIFY_FILE
  if (path === undefined || path === '') return {}
  return { notify: recordingNotifyOf(path) }
}

const contextMirrorOf = () => {
  const root = process.env.CONTEXT_MIRROR_DIR
  if (root === undefined || root === '') return {}
  return {
    contextMirror: {
      content: new DiskContextContentStore({ root }),
      contextDir: (sessionId: string) => contextDirOf(sessionId, process.env.SANDBOX_HOME),
    },
  }
}

const recordingNotifyOf =
  (path: string): NotifyDispatch =>
  async (send) => {
    appendFileSync(
      path,
      `${JSON.stringify({
        sessionId: send.sessionId,
        threadId: send.threadId,
        seq: send.seq,
        moment: send.moment,
        verdict: send.decision.verdict,
        holdMs: send.decision.holdMs,
        pending: send.decision.pending,
        operatorTurn: send.decision.operatorTurn,
      })}\n`,
    )
  }

const testTokens = () => ({
  issue: async (): Promise<never> => {
    throw new Error('unused')
  },
})

const authFaultOf = (thrown: unknown): TurnFault | undefined => {
  if (typeof thrown !== 'object' || thrown === null) return undefined
  const fault = (thrown as { fault?: unknown }).fault
  if (fault !== 'auth') return undefined
  const message = (thrown as { message?: unknown }).message
  return new TurnFault({
    kind: ERunFailureKind.Auth,
    message: typeof message === 'string' ? message : 'the provider refused the credential',
  })
}

const scriptedStepsOf = (steps: readonly ScriptedModelStep[]): ScriptedModelStep[] =>
  steps.map((step) => {
    if (!('throws' in step)) return step
    const fault = authFaultOf(step.throws)
    return fault === undefined ? step : { throws: fault }
  })

const pluginsOf = (plugins: ComposedPlugins): ComposedPlugins => {
  const gate = toolGateOf(process.env.PLUGIN_TOOL_GATE)
  if (gate === undefined) return plugins
  return {
    ...plugins,
    pod: {
      ...plugins.pod,
      tools: (ctx) => gatedToolsOf({ gate, tools: plugins.pod.tools(ctx) }),
    },
  }
}

const main = async (): Promise<void> => {
  const holderLabel = requireEnv('HOLDER_ID')
  const daemonSecret = requireEnv('DAEMON_SECRET')
  const daemonUrl = requireEnv('DAEMON_URL')
  const workspace = requireEnv('WORKSPACE_DIR')
  const scripts = JSON.parse(readFileSync(requireEnv('SCRIPT_FILE'), 'utf8')) as Record<
    string,
    ScriptedModelStep[]
  >

  const pool = createPool(requireEnv('DATABASE_URL'), {
    queryTimeoutMs: numberEnv('DB_QUERY_TIMEOUT_MS', 10_000),
  })
  const log = new JsonLog()
  const composedPlugins = composedPluginsOf({ jinaApiKey: process.env.JINA_API_KEY })
  const realPlane = new ControlPlane({
    store: new PostgresControlStore(createDb(pool)),
    eventSchema: controlEventSchema,
    pluginViews: composedPlugins.views,
    ...podResizeViewHooksOf({ path: process.env.POD_RESIZE_FILE, log }),
  })
  const fault = hostFaultOf(process.env.FAULT)
  const plane = faultedPlane({ plane: realPlane, fault, log })
  const liveFrames = createRedisLiveFrames({ url: requireEnv('REDIS_URL'), log })
  tapToolOutput(liveFrames)
  const podCalls = createRedisPodCallBus({ url: requireEnv('REDIS_URL'), log })
  const wakes = startPgWakeListener({ url: requireEnv('DATABASE_DIRECT_URL'), log })
  const bus = createHostBus({ wakes, liveFrames })
  const timers = { now: () => Date.now(), ...systemTimers }
  const sandbox = new FixedEndpointSandboxProvider({
    url: daemonUrl,
    daemonSecret,
    urls: daemonUrls(),
    urlFile: process.env.DAEMON_URL_FILE,
  })
  faultSandbox({ sandbox, fault, log })
  const pgPresence = createPgHostPresence({
    url: requireEnv('PRESENCE_DATABASE_URL'),
    label: holderLabel,
    log,
  })
  let hostId = -1
  const presence = {
    ...pgPresence,
    register: async () => {
      hostId = await pgPresence.register()
      return hostId
    },
  }
  let watch: HostWatch | undefined
  let held: SessionHolder | undefined
  const generations = new Map<string, number>()
  const holder = new SessionHolder({
    presence,
    plane,
    bus,
    timers,
    runtimes: createSessionRuntimeFactory({
      config: testSource(),
      tokens: testTokens(),
      github: { read: async () => null },
      sandbox: singleProviderRegistry(sandbox),
      daemonSecret,
      timers,
      modelFor: ({ sessionId }) => {
        const generation = (generations.get(sessionId) ?? 0) + 1
        generations.set(sessionId, generation)
        const script = scripts[`${sessionId}@${generation}`] ?? scripts[sessionId] ?? []
        const plain = (): ModelPort =>
          new ScriptedModel(scriptedStepsOf(script), undefined, existsSync)
        const routes = scriptRoutesOf({ sessionId, host: holderLabel, scripts })
        const model =
          routes.length === 0
            ? plain()
            : routedModelOf({ routes, fallback: plain, fileExists: existsSync })
        return withFirstChunkMarker(recordModelOf({ model, host: holderLabel, sessionId }))
      },
      launchDirectory: workspace,
      sandboxHome: process.env.SANDBOX_HOME,
      panelHolds: (sessionId) => held?.demandOf().panel.countOf(sessionId) ?? 0,
      plugins: process.env.FAULT_PLUGINS === '1' ? pluginsOf(composedPlugins) : undefined,
      log,
      pingMs: numberEnv('PING_MS', 10_000),
    }),
    ids: new RandomIds(),
    appendRetryMs: numberEnv('APPEND_RETRY_MS', 2_500),
    drainCapMs: numberEnv('DRAIN_CAP_MS', DRAIN_IN_FLIGHT_CAP_MS),
    sweepMs: numberEnv('SWEEP_MS', 20_000),
    commands: composeCommands([...nativeCommands, ...composedPlugins.commands]),
    commandHandlers: nativeCommandHandlers,
    podCommands: [composedPlugins.pod.commands],
    controlHandlers: new Map([
      ...nativeControlHandlers,
      [resize.spec.name, podResizeHandlerOf({ plane, dispatcher: noPodResizeDispatcher })],
    ]),
    log,
    podCallBus: podCalls,
    ...contextMirrorOf(),
    ...notifyOf(),
    onHostIdChanged: () => watch?.recompute(),
  })
  held = holder
  await holder.start()
  if (process.env.NO_RING !== '1') {
    watch = startHostWatch({
      url: requireEnv('PRESENCE_DATABASE_URL'),
      selfId: () => holder.hostId(),
      ring: () => holder.ring(),
      onHostChange: (listener) => wakes.onHostChange(listener),
      log,
    })
  }
  log.info({ source: 'host-process', message: `started hostId=${hostId} label=${holderLabel}` })

  let shuttingDown = false
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) process.exit(1)
    shuttingDown = true
    log.info({ source: 'host-process', message: 'draining' })
    await holder.drain()
    await watch?.close()
    await pgPresence.close()
    await wakes.close()
    await liveFrames.close()
    await podCalls.close()
    await pool.end()
    process.exit(0)
  }
  const handleSignal = (): void => {
    shutdown().catch((error: unknown) => {
      log.error({ source: 'host-process', message: 'shutdown failed', ...logFieldsOf({ error }) })
      process.exit(1)
    })
  }
  process.on('SIGTERM', handleSignal)
  process.on('SIGINT', handleSignal)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
