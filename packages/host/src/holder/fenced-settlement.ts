import type { ControlPlane } from '@dltech/atlas-control'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

export class FencedSettlement {
  private settled = false

  constructor(
    private readonly args: {
      plane: ControlPlane
      sessionId: string
      log?: LogPort | undefined
    },
  ) {}

  async settle(epoch: number): Promise<void> {
    if (this.settled) return
    this.settled = true
    try {
      const result = await this.args.plane.revoke({
        sessionId: this.args.sessionId,
        epoch,
        wantsHolder: true,
      })
      if (!result.ok) {
        this.args.log?.warn({
          source: 'holder.settle',
          message: `the lease on ${this.args.sessionId} had already moved on before the fence was settled`,
          data: { sessionId: this.args.sessionId, epoch, current: result.refusal.current },
        })
      }
    } catch (error) {
      this.args.log?.warn({
        source: 'holder.settle',
        message: `settling the fenced lease on ${this.args.sessionId} failed`,
        ...logFieldsOf({ error }),
      })
    }
  }
}
