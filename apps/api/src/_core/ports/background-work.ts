export abstract class BackgroundWork {
  abstract keepAlive(work: Promise<unknown>): void
}
