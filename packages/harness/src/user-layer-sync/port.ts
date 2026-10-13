export abstract class UserLayerSyncPort {
  abstract start(): Promise<void>
  abstract pullNow(): Promise<void>
  abstract stop(): void
}

export class NullUserLayerSync extends UserLayerSyncPort {
  async start(): Promise<void> {}

  async pullNow(): Promise<void> {}

  stop(): void {}
}
