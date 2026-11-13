import { EMPTY_MCP_CONTROL, EMPTY_OPERATOR_INPUT } from '@dltech/atlas-plugin-sdk'
import { defineCommand } from '@dltech/atlas-commands'
import {
  ECommandGroup,
  ECommandTiming,
  EStage,
  EToolEffect,
  PromptFragment,
  ToolDefinition,
  type ToolInvocation,
  type ToolOutcome,
  type V2Event,
} from '@dltech/atlas-core'
import type { DaemonEventFrame } from '@dltech/atlas-protocol'
import { z } from 'zod'

import { definePlugin, type Plugin } from '..'
import {
  EMPTY_CONTROL,
  EMPTY_POD,
  type PluginPodContext,
  type PodControl,
  type PodSlot,
} from '../slots'

export type ProbeObserved = { type: 'probe-observed'; label: string }

declare module '@dltech/atlas-core' {
  interface PluginEventBodies {
    'probe-observed': ProbeObserved
  }
}

export const PROBE_FRAGMENT_ID = 'probe-fragment'
export const PROBE_FRAGMENT_TEXT = 'The probe plugin is installed.'
export const PROBE_TOOL = 'probe_tool'
export const PROBE_LABELS_VIEW = 'probe-labels'

export const probeObservedSchema: z.ZodType<ProbeObserved> = z.object({
  type: z.literal('probe-observed'),
  label: z.string().min(1),
})

export const probeLabelsView = {
  name: PROBE_LABELS_VIEW,
  initial: [] as readonly string[],
  fold: (state: readonly string[], event: V2Event): readonly string[] =>
    event.type === 'probe-observed' ? [...state, event.label] : state,
}

const probeArgs = z.strictObject({ label: z.string().min(1) })

export const probeObserve = defineCommand({
  spec: {
    name: 'probe-observe',
    summary: 'record a probe observation',
    group: ECommandGroup.Session,
    args: probeArgs,
    timing: ECommandTiming.Settled,
    handledIn: 'pod',
  },
})

export const probeRead = defineCommand({
  spec: {
    name: 'probe-read',
    summary: 'read the probe without writing',
    group: ECommandGroup.Session,
    args: z.strictObject({}),
    timing: ECommandTiming.Immediate,
    handledIn: 'control',
  },
})

export type ProbeRecord = {
  beforeStep: number
  daemonFrames: DaemonEventFrame[]
  listenerFrames: DaemonEventFrame[]
  controlReads: string[]
}

export class ProbeFragment extends PromptFragment {
  readonly id = PROBE_FRAGMENT_ID

  text(): string {
    return PROBE_FRAGMENT_TEXT
  }
}

class ProbeTool extends ToolDefinition {
  readonly name = PROBE_TOOL
  readonly description = 'record a probe observation in the session log'
  readonly effect = EToolEffect.Write
  readonly inputSchema = probeArgs

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  async invoke(args: ToolInvocation): Promise<ToolOutcome> {
    const { label } = probeArgs.parse(args.input)
    await this.ctx.append([{ type: 'probe-observed', label }])
    return { ok: true, output: label, modelText: label }
  }
}

const podOf = (record: ProbeRecord): PodSlot => ({
  ...EMPTY_POD,
  tools: (ctx) => [new ProbeTool(ctx)],
  hooks: (ctx) => {
    const stopListening = ctx.onDaemonEvent((frame) => record.listenerFrames.push(frame))
    void stopListening
    return {
      beforeStep: [
        {
          name: 'probe-before-step',
          order: { stage: EStage.Observe, nudge: 0 },
          run: async ({ assembled }) => {
            record.beforeStep += 1
            return assembled
          },
        },
      ],
    }
  },
  prompts: [new ProbeFragment()],
  commands: new Map([
    [
      probeObserve.inboxKind,
      async ({ args, append }) => {
        const { label } = probeArgs.parse(args)
        await append([{ type: 'probe-observed', label }])
        return { kind: 'done' }
      },
    ],
  ]),
  onDaemonEvent: (frame) => record.daemonFrames.push(frame),
})

export const createFixturePlugin = (): { plugin: Plugin; record: ProbeRecord } => {
  const record: ProbeRecord = {
    beforeStep: 0,
    daemonFrames: [],
    listenerFrames: [],
    controlReads: [],
  }
  const plugin = definePlugin({
    name: 'probe',
    events: [probeObservedSchema],
    views: [probeLabelsView],
    commands: [probeObserve, probeRead],
    pod: podOf(record),
    control: {
      ...EMPTY_CONTROL,
      hooks: [
        {
          name: 'probe-control',
          appliesTo: (e) => e.type === 'probe-observed',
          handle: async ({ sessionId }) => {
            record.controlReads.push(`hook:${sessionId}`)
          },
        },
      ],
      commands: new Map([
        [
          probeRead.spec.name,
          async ({ sessionId }) => {
            record.controlReads.push(sessionId)
          },
        ],
      ]),
    },
    client: { hooks: [{ name: 'probe-client', appliesTo: (e) => e.type === 'probe-observed' }] },
    transport: 'stream',
  })
  return { plugin, record }
}

export const fixturePlugin: Plugin = createFixturePlugin().plugin

const noControlPlane = async () => {
  throw new Error('this test has no control plane')
}

export const podControlStub: PodControl = {
  exposePort: noControlPlane,
  mcp: EMPTY_MCP_CONTROL,
  operator: EMPTY_OPERATOR_INPUT,
  webSearch: { config: noControlPlane },
  memory: {
    list: noControlPlane,
    read: noControlPlane,
    write: noControlPlane,
    edit: noControlPlane,
    delete: noControlPlane,
  },
}
