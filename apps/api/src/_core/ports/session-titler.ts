export abstract class SessionTitler {
  abstract nameOf(args: { userId: string; projectId: string; text: string }): Promise<string | null>
}

export class NoSessionTitler extends SessionTitler {
  async nameOf(): Promise<string | null> {
    return null
  }
}
