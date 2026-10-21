import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  API_PROVISIONED_ENV,
  BOOT_RUN_ID,
  bootStepDraftOf,
  createBootReporter,
  EBootStep,
  EBootStepState,
  ESandboxProvisionState,
  type BootReporter,
  type SandboxProvisionReply,
  type VercelCredentials,
} from '@dltech/atlas-wire'
import { db } from '../../../db'
import type { ThreadModel } from '../../../db'
import { EnvService } from '../../../_core/config/env/env.service'
import { BackgroundWork } from '../../../_core/ports/background-work'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { appendWithin } from '../../platform/sessions/append'
import { ownedThread } from '../../platform/sessions/ownership'
import { failureText, SANDBOX_WAKE_BOOT, type SandboxWakeBoot } from '../github/github-sandbox-wake-boot'
import { VercelNotConfiguredError } from '../scoped-config/scoped-config.errors'
import { ScopedConfigService } from '../scoped-config/scoped-config.service'
import { workspaceSpecWriter } from './sandbox-provisioning-bootstrap'
import {
  claimRow,
  markFailed,
  markRunning,
  standingStateOf,
  type RowClaim,
} from './sandbox-provisioning-rows'

export const NO_PROJECT_MESSAGE =
  'This thread has no project. Pick a project before sending your first message.'

const DEFAULT_CLOUD_URL = 'https://api.byatlas.io'

type BootTarget = {
  thread: ThreadModel
  projectId: string
  credentials: VercelCredentials
  claim: RowClaim
  reporter: BootReporter
}

@Injectable()
export class SandboxProvisioningService {
  private readonly logger = new Logger(SandboxProvisioningService.name)
  private readonly bootsInFlight = new Set<Promise<void>>()

  constructor(
    private readonly scoped: ScopedConfigService,
    private readonly env: EnvService,
    private readonly cipher: SecretCipherService,
    @Inject(SANDBOX_WAKE_BOOT) private readonly bootAdapter: SandboxWakeBoot,
    @Inject(BackgroundWork) private readonly background: BackgroundWork,
  ) {}

  async settle(): Promise<void> {
    await Promise.all([...this.bootsInFlight])
  }

  async provision(args: {
    userId: string
    threadId: string
    projectId?: string | undefined
  }): Promise<SandboxProvisionReply> {
    const thread = await ownedThread({ reader: db, userId: args.userId, threadId: args.threadId })
    const reporter = this.reporterOf(thread)
    const projectId = await this.resolveProject({ thread, requested: args.projectId })
    if (projectId === undefined) return this.notConfigured({ reporter, error: NO_PROJECT_MESSAGE })

    const existing = await db.cloudSandbox.findUnique({ where: { threadId: thread.id } })
    const standing = existing === null ? undefined : standingStateOf(existing)
    if (standing !== undefined) return { state: standing }

    const credentials = await this.credentialsOf({ userId: args.userId, projectId })
    if (credentials instanceof VercelNotConfiguredError) {
      return this.notConfigured({ reporter, error: credentials.message })
    }
    const claim = await claimRow({ thread, existing, cipher: this.cipher })
    if (claim !== null) this.startBoot({ thread, projectId, credentials, claim, reporter })
    return { state: ESandboxProvisionState.Booting }
  }

  private async resolveProject(args: {
    thread: ThreadModel
    requested: string | undefined
  }): Promise<string | undefined> {
    if (args.thread.projectId !== null) return args.thread.projectId
    if (args.requested === undefined) return undefined
    await this.scoped.accessibleProject({ userId: args.thread.userId, projectId: args.requested })
    await db.thread.update({
      where: { id: args.thread.id },
      data: { projectId: args.requested, executionLocation: 'cloud' },
    })
    return args.requested
  }

  private async credentialsOf(args: {
    userId: string
    projectId: string
  }): Promise<VercelCredentials | VercelNotConfiguredError> {
    try {
      return await this.scoped.vercelCredentials({ projectId: args.projectId })
    } catch (failure) {
      if (failure instanceof VercelNotConfiguredError) return failure
      throw failure
    }
  }

  private async notConfigured(args: { reporter: BootReporter; error: string }): Promise<SandboxProvisionReply> {
    await args.reporter.report({
      step: EBootStep.Provision,
      state: EBootStepState.Error,
      error: args.error,
    })
    return { state: ESandboxProvisionState.NotConfigured, error: args.error }
  }

  private reporterOf(thread: ThreadModel): BootReporter {
    return createBootReporter({
      log: (line) => this.logger.warn(line),
      sink: async (events) => {
        await db.$transaction((tx) =>
          appendWithin({
            tx,
            threadId: thread.id,
            userId: thread.userId,
            runId: BOOT_RUN_ID,
            drafts: events.map(bootStepDraftOf),
          }),
        )
      },
    })
  }

  private startBoot(target: BootTarget): void {
    const work = this.runBoot(target).finally(() => this.bootsInFlight.delete(work))
    this.bootsInFlight.add(work)
    this.background.keepAlive(work)
  }

  private async runBoot(target: BootTarget): Promise<void> {
    const { thread, claim } = target
    try {
      const { serveUrl } = await this.bootAdapter.boot({
        credentials: target.credentials,
        name: claim.name,
        threadId: thread.id,
        image: this.env.get('SANDBOX_IMAGE'),
        cloudUrl: this.env.get('ATLAS_CLOUD_URL') ?? DEFAULT_CLOUD_URL,
        serveVersion: undefined,
        freshToken: claim.token,
        resumeToken: claim.token,
        onFreshSandbox: () => Promise.resolve(),
        injectVercelCredentials: false,
        environment: { [API_PROVISIONED_ENV]: '1' },
        reporter: target.reporter,
        prepare: workspaceSpecWriter({ projectId: target.projectId, model: thread.modelRef }),
      })
      await markRunning({ threadId: thread.id, serveUrl })
      this.logger.log(`provisioned sandbox ${claim.name} for thread ${thread.id} — serve at ${serveUrl}`)
    } catch (failure) {
      this.logger.warn(`provisioning sandbox ${claim.name} for thread ${thread.id} failed: ${failureText(failure)}`)
      await markFailed({ threadId: thread.id, wakeClaim: claim.wakeClaim }).catch((releaseFailure: unknown) => {
        this.logger.warn(`releasing the claim on thread ${thread.id} failed: ${failureText(releaseFailure)}`)
      })
    }
  }
}
