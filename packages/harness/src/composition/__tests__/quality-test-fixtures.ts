import { Glob } from 'bun'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ATLAS_SETTINGS,
  DecisionPort,
  EQualityImpact,
  ESettingId,
  QualityReviewPort,
  toCallId,
  toRunId,
  type DecisionAnswer,
  type DecisionOutcome,
  type DecisionQuestion,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'

import { portToken, type DependencyContainer } from '../../container/injection'
import { MemorySettingsStore } from '../../settings/memory-store'
import { createSettingsService } from '../../settings/service'
import { ToolDispatcher } from '../../tools/dispatch'
import { bindQuality } from '../compose-quality'
import { composeHarness } from '../compose'
import type { HarnessApp } from '../harness-app'
import type { SettingsBinding } from '../settings-binding'
import { recordingNotices } from './fakes'

export const WIDGET_SOURCE = [
  'export class Widget {',
  '  load() { return fetchRows() }',
  '  render() { return paint(this.load()) }',
  '  save() { return persist(this.load()) }',
  '}',
  '',
].join('\n')

const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'Quality Spec',
  GIT_AUTHOR_EMAIL: 'quality@example.test',
  GIT_COMMITTER_NAME: 'Quality Spec',
  GIT_COMMITTER_EMAIL: 'quality@example.test',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
}

const ISOLATED_ENV_KEYS = ['ATLAS_HOME', 'HOME', ...Object.keys(GIT_ENV)]

const git = (args: { cwd: string; argv: readonly string[] }): void => {
  const result = Bun.spawnSync({ cmd: ['git', ...args.argv], cwd: args.cwd, env: { ...process.env, ...GIT_ENV } })
  if (result.exitCode !== 0) throw new Error(`git ${args.argv.join(' ')}: ${result.stderr.toString()}`)
}

export class FakeDecisions extends DecisionPort {
  readonly calls: { models: (string | undefined)[]; questionKeys: string[] }[] = []
  mode: 'introduce' | 'fault' = 'introduce'

  async decide(args: {
    state: string
    questions: Record<string, DecisionQuestion>
    signal: AbortSignal
    model?: string | undefined
  }): Promise<DecisionOutcome> {
    this.calls.push({ models: [args.model], questionKeys: Object.keys(args.questions) })
    if (this.mode === 'fault') return { ok: false, fault: 'fake transport unavailable' }

    const answers: Record<string, DecisionAnswer> = {}
    for (const [key, question] of Object.entries(args.questions)) {
      if (key.endsWith(':currentConcern')) answers[key] = { noul: 0.9 }
      if (key.endsWith(':impact')) {
        answers[key] = { choice: EQualityImpact.Introduced, probabilities: { [EQualityImpact.Introduced]: 0.95 } }
      }
      if (key.endsWith(':focus') && question.type === 'choice') {
        const candidate = Object.keys(question.criteria).find((id) => id !== 'none' && id !== 'uncertain') ?? 'none'
        answers[key] = { choice: candidate, probabilities: { [candidate]: 0.95 } }
      }
    }
    return { ok: true, answers, model: args.model }
  }
}

const settingsBinding = (): SettingsBinding => ({
  service: createSettingsService({
    definitions: ATLAS_SETTINGS,
    user: new MemorySettingsStore({ label: 'quality composition spec' }),
  }),
  bindTo: () => {},
})

export type RegistrationFacts = { qualityPortWasRegistered: boolean; decisionPortWasRegistered: boolean }

export class QualityRig {
  private callCount = 0

  private constructor(
    readonly app: HarnessApp<undefined, never>,
    readonly container: DependencyContainer,
    readonly decisions: FakeDecisions,
    readonly project: string,
    readonly facts: RegistrationFacts,
    readonly atlasHome: string,
    private readonly cleanup: () => Promise<void>,
  ) {}

  static async create(args: { command: string }): Promise<QualityRig> {
    const saved = new Map(ISOLATED_ENV_KEYS.map((key) => [key, process.env[key]]))
    const home = await realpath(await mkdtemp(join(tmpdir(), 'atlas-quality-home-')))
    const project = await realpath(await mkdtemp(join(tmpdir(), 'atlas-quality-project-')))
    process.env.ATLAS_HOME = join(home, 'atlas')
    process.env.HOME = home
    Object.assign(process.env, GIT_ENV)
    git({ cwd: project, argv: ['init', '-b', 'main'] })
    git({ cwd: project, argv: ['commit', '--allow-empty', '-m', 'root'] })

    const decisions = new FakeDecisions()
    const settings = settingsBinding()
    let captured: DependencyContainer | undefined
    const facts: RegistrationFacts = { qualityPortWasRegistered: false, decisionPortWasRegistered: false }
    const app = await composeHarness<undefined, never>({
      launch: { cwd: project, command: args.command, model: undefined, executionLocation: undefined },
      env: {},
      settings,
      clientVersion: 'quality-spec',
      surface: {
        notice: recordingNotices().port,
        bind: ({ container }) => {
          captured = container
          facts.decisionPortWasRegistered = container.isRegistered(portToken(DecisionPort), true)
          facts.qualityPortWasRegistered = container.isRegistered(portToken(QualityReviewPort), true)
          container.register(portToken(DecisionPort), { useValue: decisions })
          bindQuality({ container, settings: settings.service })
          return undefined
        },
      },
    })
    if (captured === undefined) throw new Error('surface.bind never ran')

    const cleanup = async (): Promise<void> => {
      await app.close()
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      await rm(home, { recursive: true, force: true })
      await rm(project, { recursive: true, force: true })
    }
    return new QualityRig(app, captured, decisions, project, facts, process.env.ATLAS_HOME ?? '', cleanup)
  }

  dispose(): Promise<void> {
    return this.cleanup()
  }

  setting(args: { id: string; value: boolean }): void {
    const written = this.app.settings.set(args)
    if (!written.ok) throw new Error(`setting ${args.id} did not land: ${written.message}`)
  }

  enableReview(): void {
    this.setting({ id: ESettingId.QualityEnabled, value: true })
  }

  async newThread(): Promise<ThreadId> {
    return (await this.app.threads.create({})).id
  }

  async dispatchWrite(args: { threadId: ThreadId; relative: string; content: string }): Promise<readonly EventDraft[]> {
    this.callCount += 1
    const dispatcher = this.container.resolve(portToken(ToolDispatcher))
    return dispatcher.dispatch({
      call: {
        callId: toCallId(`call-${this.callCount}`),
        name: 'write',
        input: { path: join(this.project, args.relative), content: args.content },
        runId: toRunId('run-quality'),
        threadId: args.threadId,
      },
      signal: new AbortController().signal,
      projectDirectory: this.project,
      events: await this.app.log.read({ threadId: args.threadId }),
    })
  }

  async persist(args: { threadId: ThreadId; drafts: readonly EventDraft[] }): Promise<void> {
    await this.app.log.append({ threadId: args.threadId, runId: this.app.ids.nextRunId(), drafts: args.drafts })
  }

  async exampleFiles(threadId: ThreadId): Promise<string[]> {
    const glob = new Glob(`sessions/**/threads/${threadId}/quality/examples/*.json`)
    return Array.fromAsync(glob.scan({ cwd: this.atlasHome }))
  }

  async onDisk(relative: string): Promise<string> {
    return readFile(join(this.project, relative), 'utf8')
  }
}

export const typesOf = (drafts: readonly EventDraft[]): string[] => drafts.map((draft) => draft.type)
