import type { ERunFailureKind } from '@dltech/atlas-core'

export class TurnFault extends Error {
  readonly kind: ERunFailureKind
  readonly detail: unknown

  constructor(args: { kind: ERunFailureKind; message: string; detail?: unknown }) {
    super(args.message)
    this.name = 'TurnFault'
    this.kind = args.kind
    this.detail = args.detail
  }
}
