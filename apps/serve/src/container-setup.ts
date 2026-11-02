import { join } from 'node:path'

import { ENoticeTone, type NoticePort } from '@dltech/atlas-core'
import { parseContainerJson } from '@dltech/atlas-harness'

import { runCommand, type CommandRunner } from './run-command'
import { nodeWorkspaceFiles, type WorkspaceFiles } from './workspace-files'

export const CONTAINER_SETUP_MARKER = 'operational/container-setup.done'

const OUTPUT_TAIL = 2000
export const SETUP_SCRIPT_TIMEOUT_MS = 15 * 60_000
const NOTICE_KEY = 'cloud-container-setup'
export const CONTAINER_SETUP_FAILURE_KEY = 'cloud-container-setup-failed'

type Plan = {
  setup: string | undefined
  start: string | undefined
  env: Record<string, string>
  unapplied: string[]
  problem: string | undefined
}

const planOf = async (args: { files: WorkspaceFiles; file: string }): Promise<Plan> => {
  const plan: Plan = {
    setup: undefined,
    start: undefined,
    env: {},
    unapplied: [],
    problem: undefined,
  }
  if (!(await args.files.exists(args.file))) return plan
  const parsed = parseContainerJson({
    text: await args.files.read(args.file),
    file: args.file,
  })
  if (!parsed.ok) return { ...plan, problem: parsed.refusal.detail }
  const { config } = parsed
  if (config.image !== undefined) plan.unapplied.push('image')
  if (config.dockerfile !== undefined) plan.unapplied.push('dockerfile')
  if (parsed.mounts.length > 0) plan.unapplied.push('mounts')
  return {
    ...plan,
    setup: config.setup,
    start: config.start,
    env: config.env ?? {},
  }
}

export enum EContainerSetupResult {
  None = 'none',
  Ran = 'ran',
  Skipped = 'skipped',
  Failed = 'failed',
}

export type ContainerSetup = (args: {
  cwd: string
  atlasHome: string
  env: Record<string, string | undefined>
  setupScript?: string | null | undefined
  notice: NoticePort
}) => Promise<EContainerSetupResult>

const failureNoticeOf = (args: { source: string; tail: string; startSkipped: boolean }): string => {
  const skipped = args.startSkipped ? ', and the start script was skipped' : ''
  const output = args.tail === '' ? '(no output)' : args.tail
  return `The ${args.source} failed; the sandbox started anyway${skipped}. Last output:\n${output}`
}

export function createContainerSetup(args: {
  files?: WorkspaceFiles | undefined
  run?: CommandRunner | undefined
  timeoutMs?: number | undefined
}): ContainerSetup {
  const files = args.files ?? nodeWorkspaceFiles
  const run = args.run ?? runCommand
  const timeoutMs = args.timeoutMs ?? SETUP_SCRIPT_TIMEOUT_MS

  return async ({ cwd, atlasHome, env, setupScript, notice }) => {
    const warn = (text: string, sticky = false): void =>
      notice.notify({
        key: sticky ? CONTAINER_SETUP_FAILURE_KEY : NOTICE_KEY,
        tone: ENoticeTone.Warn,
        text,
        ...(sticky ? { ttlMs: null } : {}),
      })
    try {
      const plan = await planOf({
        files,
        file: join(cwd, '.atlas', 'container.json'),
      })
      if (plan.problem !== undefined) warn(`.atlas/container.json was not applied: ${plan.problem}`)
      else if (plan.unapplied.length > 0) {
        warn(`.atlas/container.json ${plan.unapplied.join(', ')}: not applied in Cloud sandboxes`)
      }
      Object.assign(env, plan.env)

      const script = (command: string) =>
        run({
          command: ['sh', '-c', command],
          cwd,
          env: plan.env,
          timeoutMs,
        }).then((outcome) =>
          outcome.ok ? undefined : `${outcome.stdout}${outcome.stderr}`.trim().slice(-OUTPUT_TAIL),
        )

      const override = setupScript?.trim() ?? ''
      const overridden = override !== ''
      const setup = overridden ? override : plan.setup
      const setupSource = overridden
        ? 'setup script (project settings)'
        : 'setup script (.atlas/container.json "setup")'
      const marker = join(atlasHome, CONTAINER_SETUP_MARKER)
      let ran = false
      if (setup !== undefined) {
        if (await files.exists(marker)) {
          if (plan.start === undefined) return EContainerSetupResult.Skipped
        } else {
          const tail = await script(setup)
          if (tail !== undefined) {
            warn(
              failureNoticeOf({
                source: setupSource,
                tail,
                startSkipped: plan.start !== undefined,
              }),
              true,
            )
            return EContainerSetupResult.Failed
          }
          await files.write({ path: marker, text: new Date().toISOString() })
          ran = true
        }
      }
      if (plan.start === undefined)
        return ran ? EContainerSetupResult.Ran : EContainerSetupResult.None
      const tail = await script(plan.start)
      if (tail === undefined) return EContainerSetupResult.Ran
      warn(
        failureNoticeOf({
          source: 'start script (.atlas/container.json "start")',
          tail,
          startSkipped: false,
        }),
        true,
      )
      return EContainerSetupResult.Failed
    } catch (failure) {
      warn(
        failureNoticeOf({
          source: 'setup script',
          tail: failure instanceof Error ? failure.message : String(failure),
          startSkipped: false,
        }),
        true,
      )
      return EContainerSetupResult.Failed
    }
  }
}
