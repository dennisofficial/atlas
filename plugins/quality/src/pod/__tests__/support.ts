import {
  EQualityImpact,
  EToolEffect,
  stampDrafts,
  toCallId,
  toEventId,
  toRunId,
  toThreadId,
  type CapturedFileChange,
  type ClassifierOutcome,
  type ClassifierQuestion,
  type CodeQualityReviewedBody,
  type DecisionAnswer,
  type Event,
  type EventDraft,
  type ToolCall,
  type ToolOutcome,
  type RecordEvent,
} from '@dltech/atlas-core'
import {
  EMPTY_ANALYTICS,
  EMPTY_CREW,
  EMPTY_MCP_CONTROL,
  EMPTY_MESSAGES,
  EMPTY_POD_RESOURCES,
  EMPTY_ROUTINES,
  EMPTY_SESSIONS,
  EMPTY_SUBSCRIPTIONS,
  EMPTY_WORKTREES,
  UNVERSIONED_SETTINGS,
  type PluginPodContext,
  type PodAnalytics,
  type PodAnalyticsValue,
  type PodClassifier,
} from '@dltech/atlas-plugin-sdk'

import type { AfterToolHook } from '@dltech/atlas-agent'
import type { HookOutcome } from '@dltech/atlas-core'

import { qualityPodOf, type QualityPodOptions } from '..'
import { JEV_QUALITY_MODEL } from '../../review/request'

export const THREAD = toThreadId('thread-1')
export const CALL = toCallId('call-1')
export const RUN = toRunId('run-1')
export const PROJECT = '/repo'
export const FILE = `${PROJECT}/src/widget.ts`

const BEFORE = 'export class Widget {\n  run() {\n    return 1\n  }\n}\n'
const AFTER =
  'export class Widget {\n  run() {\n    return 1\n  }\n\n  audit() {\n    return 2\n  }\n}\n'

export const change: CapturedFileChange = { path: FILE, before: BEFORE, after: AFTER }

export const changesUnder = (directory: string): CapturedFileChange => ({
  path: `${directory}/src/widget.ts`,
  before: BEFORE,
  after: AFTER,
})

export const writeCall = (overrides: Partial<ToolCall> = {}): ToolCall => ({
  callId: CALL,
  name: 'write',
  input: {},
  effect: EToolEffect.Write,
  threadId: THREAD,
  ...overrides,
})

export const readCall = (): ToolCall => ({ ...writeCall(), name: 'read', effect: EToolEffect.Read })

export const wroteWithChanges = (
  overrides: Partial<Extract<ToolOutcome, { ok: true }>> = {},
): ToolOutcome => ({
  ok: true,
  output: {},
  modelText: 'wrote',
  fileChanges: [change],
  ...overrides,
})

export const wroteNothing = (): ToolOutcome => ({ ok: true, output: {}, modelText: 'wrote' })

export const failed = (): ToolOutcome => ({ ok: false, reason: 'the disk is full' })

export type ClassifyArgs = { questions: Record<string, ClassifierQuestion> }

const answerFor = ({ question }: { question: ClassifierQuestion }): DecisionAnswer => {
  if (question.type === 'noul') return { noul: 0.9 }
  const choice = Object.keys(question.criteria)[0]
  if (choice === undefined) throw new Error('a choice question offers no criterion')
  return { choice, confidence: 0.9 }
}

export const introducing = async (args: ClassifyArgs): Promise<ClassifierOutcome> => ({
  ok: true,
  model: JEV_QUALITY_MODEL,
  answers: Object.fromEntries(
    Object.entries(args.questions).map(([name, question]) => [
      name,
      question.type === 'choice' && name.endsWith(':impact')
        ? { choice: EQualityImpact.Introduced, confidence: 0.9 }
        : answerFor({ question }),
    ]),
  ),
})

export type RigOptions = {
  classifierOn?: boolean
  classify?: ((args: ClassifyArgs) => Promise<ClassifierOutcome>) | undefined
  settings?:
    | { enabled: boolean; policies: Readonly<Record<string, boolean>>; examples: boolean }
    | undefined
  budgetMs?: number | undefined
  events?: readonly Event[] | undefined
  analytics?: PodAnalytics | undefined
}

export const monotonicClock = (): (() => number) => {
  let now = 0
  return () => (now += 5)
}

export function createRig(options: RigOptions = {}) {
  const logs: string[] = []
  const classifyCalls: ClassifyArgs[] = []
  const settings = options.settings ?? { enabled: true, policies: {}, examples: false }
  const scripted = options.classify ?? introducing
  const classifier: PodClassifier = {
    status: () =>
      (options.classifierOn ?? true)
        ? { on: true, model: JEV_QUALITY_MODEL, provider: 'jev' }
        : { on: false, reason: 'no classifier' },
    classify: async (args) => {
      classifyCalls.push({ questions: args.questions })
      return await scripted({ questions: args.questions })
    },
  }

  const ctx: PluginPodContext = {
    sessionId: 's1',
    control: {
      settingsVersions: async () => UNVERSIONED_SETTINGS,
      exposePort: async () => {
        throw new Error('this rig exposes no port')
      },
      memory: {
        list: async () => ({ project: null, memories: [] }),
        read: async () => null,
        write: async () => {
          throw new Error('this rig writes no memory')
        },
        edit: async () => {
          throw new Error('this rig edits no memory')
        },
        delete: async () => false,
      },
      mcp: EMPTY_MCP_CONTROL,
      gateway: { apiKey: async () => undefined, imageModel: async () => undefined },
      routines: EMPTY_ROUTINES,
      subscriptions: EMPTY_SUBSCRIPTIONS,
    },
    resources: EMPTY_POD_RESOURCES,
    crew: EMPTY_CREW,
    messages: EMPTY_MESSAGES,
    classifier,
    analytics: options.analytics ?? EMPTY_ANALYTICS,
    sessions: EMPTY_SESSIONS,
    worktrees: EMPTY_WORKTREES,
    append: async () => undefined,
    notify: async () => undefined,
    events: () => [...(options.events ?? [])] as unknown as RecordEvent[],
    call: async () => {
      throw new Error('this rig makes no daemon call')
    },
    onDaemonEvent: () => () => undefined,
    live: () => undefined,
    log: (message) => logs.push(message),
  }

  const podOptions: QualityPodOptions = {
    settings: async () => settings,
    ...(options.budgetMs === undefined ? {} : { budgetMs: options.budgetMs }),
    clock: monotonicClock(),
  }

  const hooks = qualityPodOf(podOptions).hooks?.(ctx)
  const hook = hooks?.afterTool?.[0]
  if (hook === undefined) throw new Error('the quality pod registered no afterTool hook')
  const ignored = hooks?.afterTurn?.[0]
  if (ignored === undefined) throw new Error('the quality pod registered no afterTurn hook')

  const captures = async (call: ToolCall = writeCall()): Promise<boolean> => {
    const predicate = hook.capturesFileChanges
    if (predicate === undefined) throw new Error('the quality hook asks for no capture')
    return await predicate({ call, signal: new AbortController().signal })
  }

  const run = async (
    args: {
      call?: ToolCall | undefined
      result?: ToolOutcome | undefined
      projectDirectory?: string | undefined
      signal?: AbortSignal | undefined
    } = {},
  ): Promise<HookOutcome> =>
    await hook.run({
      call: args.call ?? writeCall(),
      result: args.result ?? wroteWithChanges(),
      projectDirectory: args.projectDirectory ?? PROJECT,
      signal: args.signal ?? new AbortController().signal,
    })

  return { ctx, hook, ignored, logs, classifyCalls, settings, podOptions, captures, run }
}

export type Captured = {
  event: string
  properties: Readonly<Record<string, PodAnalyticsValue>>
}

export const analyticsRecorder = (): { captured: Captured[]; analytics: PodAnalytics } => {
  const captured: Captured[] = []
  return { captured, analytics: { capture: (args) => captured.push(args) } }
}

export type Rig = ReturnType<typeof createRig>

export const recordsOf = (drafts: readonly EventDraft[]): readonly CodeQualityReviewedBody[] =>
  drafts.filter((draft): draft is CodeQualityReviewedBody => draft.type === 'code-quality-reviewed')

export const afterToolHook = ({ rig }: { rig: Rig }): AfterToolHook => rig.hook

export const historyOf = (drafts: readonly EventDraft[]): readonly Event[] =>
  stampDrafts({
    drafts,
    envelopes: drafts.map((_draft, index) => ({
      id: toEventId(`event-${index + 1}`),
      seq: index + 1,
      threadId: THREAD,
      runId: RUN,
      depth: 0,
      at: '2026-11-20T00:00:00.000Z',
    })),
  })
