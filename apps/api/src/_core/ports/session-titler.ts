import type { SaidImage } from '@dltech/atlas-core'

export abstract class SessionTitler {
  abstract nameOf(args: {
    userId: string
    projectId: string
    text: string
    images?: readonly SaidImage[] | undefined
  }): Promise<string | null>
}

export class NoSessionTitler extends SessionTitler {
  async nameOf(): Promise<string | null> {
    return null
  }
}
