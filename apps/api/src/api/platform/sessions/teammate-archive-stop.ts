import { Injectable, Logger } from '@nestjs/common'
import { EAgentStatus, EKilledBy } from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import { podSessionOf } from './session-of-thread'
import { hasBootSteps } from '../sandboxes/sandbox-boot-steps'
import { VercelSandboxClient } from '../sandboxes/vercel-sandbox.client'
import { appendStoredWithin, nextRunId } from './append'
import { ThreadSignalsService } from './thread-signals.service'

const failureText = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

/**
 * Archiving a teammate session stops it spending: the lead's pod still runs the teammate's loop,
 * sub-agents and background shells, because a teammate owns no sandbox of its own. A top-level
 * session owns the pod and is parked by the archive cleanup instead, so it never reaches here.
 */
@Injectable()
export class TeammateArchiveStopService {
  private readonly logger = new Logger(TeammateArchiveStopService.name)

  constructor(
    private readonly vercel: VercelSandboxClient,
    private readonly signals: ThreadSignalsService,
  ) {}

  async stopIfManaged(args: {
    userId: string
    sessionId: string
    threadId: string
  }): Promise<void> {
    const { userId, sessionId, threadId } = args
    const session = await db.orm.public.Session.where({ id: sessionId })
      .select('managedBySessionId')
      .first()
    if (session === null || session.managedBySessionId === null) return

    const podSessionId = await podSessionOf({ reader: db, threadId })
    const sandbox = await db.orm.public.CloudSandbox.where({ sessionId: podSessionId })
      .select('name')
      .first()
    if (sandbox === null) return
    if (!(await hasBootSteps({ threadId }))) return

    const lead = await db.orm.public.Session.where({ id: podSessionId })
      .select('mainThreadId')
      .first()
    if (lead?.mainThreadId != null)
      await this.recordEnding({ userId, leadThreadId: lead.mainThreadId, threadId })

    try {
      await this.vercel.stopTeammate({ threadId, name: sandbox.name, agentId: threadId })
    } catch (failure) {
      this.logger.warn(
        `stopping teammate ${threadId} in pod ${sandbox.name} failed: ${failureText(failure)}`,
      )
    }
  }

  /**
   * The durable record of the stop: the pod's next boot rebuilds the roster from this log and
   * reads the teammate as deliberately stopped, so it is never resumed.
   */
  private async recordEnding(args: {
    userId: string
    leadThreadId: string
    threadId: string
  }): Promise<void> {
    try {
      await db.transaction((tx) =>
        appendStoredWithin({
          tx,
          threadId: args.leadThreadId,
          userId: args.userId,
          runId: nextRunId(),
          drafts: [
            {
              type: 'agent-ended',
              body: JSON.stringify({
                type: 'agent-ended',
                agentId: args.threadId,
                agentType: 'teammate',
                intent: '',
                status: EAgentStatus.Stopped,
                killedBy: EKilledBy.User,
                prose: '',
                turns: 0,
                toolCalls: 0,
                relayed: false,
              }),
            },
          ],
        }),
      )
      this.signals.threadChanged({ threadId: args.leadThreadId })
    } catch (failure) {
      this.logger.warn(
        `recording the done ending for teammate ${args.threadId} failed: ${failureText(failure)}`,
      )
    }
  }
}
