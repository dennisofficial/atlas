import { db } from '@dltech/atlas-db'

import { EGithubCallSource } from './github-call-log'
import { type CheckSuiteShape, pendingCheckSuiteCountOf } from './github-check-suites'
import { readHeadCheckSuites } from './github-head-checks-read'
import type { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { dischargeHeldGreen, heldGreenOwed, settlementSnapshotOf } from './github-pr-head-checks'
import { normalizedRepo } from './github-pr-identity'
import { lockPrScope } from './github-pr-lock'
import { GithubPrOutboxWriter, PrEffectCollector, type HeldGreen } from './github-pr-outbox'
import { PR_OUTBOX_MAX_ATTEMPTS } from './github-pr-outbox-lease'
import { GithubPrTokenUnavailable } from './github-pr-reconcile'
import { recordHeadVerdict } from './github-pr-transition-push'
import { withGithubRequestBudget, type GithubHttpBudget } from './github-request-budget'
import { githubJsonGet } from './github-user-http'

export type HeadSuitesRead = (args: {
  token: string
  owner: string
  repo: string
  headSha: string
}) => Promise<readonly CheckSuiteShape[]>

export const restHeadSuitesRead: HeadSuitesRead = (args) =>
  readHeadCheckSuites({
    get: <T>(path: string) =>
      githubJsonGet<T>({ source: EGithubCallSource.ChecksState, token: args.token, path }),
    owner: args.owner,
    repo: args.repo,
    headSha: args.headSha,
  })

export class GithubPrHeldGreenPending extends Error {
  constructor(held: HeldGreen) {
    super(
      `${held.repoFullName}#${held.prNumber} head ${held.headSha} has a queued workflow, so its green verdict waits`,
    )
  }
}

export class GithubPrHeldGreen {
  constructor(
    private readonly deps: {
      mailbox: () => GithubPrEventMailboxService
      dispatch: (outboxIds: readonly string[]) => Promise<void>
      fillTokenOf: (args: {
        repoFullName: string
        installationId: bigint | undefined
      }) => Promise<string | undefined>
      readSuites: HeadSuitesRead
      budget: GithubHttpBudget
    },
  ) {}

  async run(args: { held: HeldGreen; attempts: number }): Promise<void> {
    const held = { ...args.held, repoFullName: normalizedRepo(args.held.repoFullName) }
    if (!(await heldGreenOwed(held))) return
    const lastAttempt = args.attempts + 1 >= PR_OUTBOX_MAX_ATTEMPTS
    if (!lastAttempt && (await this.suitesPending(held))) throw new GithubPrHeldGreenPending(held)
    await this.discharge(held)
  }

  private async suitesPending(held: HeldGreen): Promise<boolean> {
    const token = await this.deps.fillTokenOf({
      repoFullName: held.repoFullName,
      installationId: undefined,
    })
    if (token === undefined) throw new GithubPrTokenUnavailable(held.repoFullName)
    const [owner, repo] = held.repoFullName.split('/') as [string, string]
    const suites = await withGithubRequestBudget({
      store: this.deps.budget,
      run: () => this.deps.readSuites({ token, owner, repo, headSha: held.headSha }),
    })
    return pendingCheckSuiteCountOf(suites) > 0
  }

  private async discharge(held: HeldGreen): Promise<void> {
    const outboxIds = await db.transaction(async (tx) => {
      const scope = await lockPrScope({ tx, repoFullName: held.repoFullName })
      const row = await scope.orm.public.GithubPrState.where({
        repoFullName: held.repoFullName,
        prNumber: held.prNumber,
      }).first()
      if (row === null || row.headSha !== held.headSha) return []
      const next = settlementSnapshotOf({ row, missingRequiredChecks: row.checksExpected })
      const effects = new PrEffectCollector()
      const writes = {
        mailbox: this.deps.mailbox(),
        repoFullName: held.repoFullName,
        prNumber: held.prNumber,
        url: row.url,
        within: { tx: scope, effects },
      }
      await dischargeHeldGreen({
        tx: scope,
        repoFullName: held.repoFullName,
        prNumber: held.prNumber,
        next,
        eventKey: held.eventKey,
        emitVerdict: (verdict, eventKey) =>
          recordHeadVerdict({ writes, next, verdict, eventKey, userIds: held.userIds }),
      })
      return await GithubPrOutboxWriter.write({
        tx: scope,
        repoFullName: held.repoFullName,
        prNumber: held.prNumber,
        effects: effects.all(),
      })
    })
    await this.deps.dispatch(outboxIds)
  }
}
