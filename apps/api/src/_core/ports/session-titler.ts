import type { SaidImage } from '@dltech/atlas-core'

export abstract class SessionTitler {
  abstract nameOf(args: {
    userId: string
    projectId: string
    text: string
    images?: readonly SaidImage[] | undefined
    modelRef?: string | undefined
    onFault?: ((fault: unknown) => void) | undefined
  }): Promise<string | null>
}

export class NoSessionTitler extends SessionTitler {
  async nameOf(): Promise<string | null> {
    return null
  }
}
