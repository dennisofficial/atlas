import { Inject, Injectable } from '@nestjs/common'
import type { SaidImage } from '@dltech/atlas-core'
import type { SessionNamer } from '../../../agent'
import { SessionTitler } from '../../../_core/ports/session-titler'

export const SESSION_NAMER = Symbol('SESSION_NAMER')

export const TITLING_TIMEOUT_MS = 20_000

type TitleSource = {
  userId: string
  projectId: string | null
  text: string
  images?: readonly SaidImage[] | undefined
  modelRef?: string | undefined
  onFault?: ((fault: unknown) => void) | undefined
}

@Injectable()
export class ThreadTitlingService extends SessionTitler {
  constructor(@Inject(SESSION_NAMER) private readonly namer: SessionNamer) {
    super()
  }

  nameOf(args: TitleSource): Promise<string | null> {
    return this.generate(args)
  }

  private generate(args: TitleSource): Promise<string | null> {
    return this.namer({ ...args, signal: AbortSignal.timeout(TITLING_TIMEOUT_MS) })
  }
}
