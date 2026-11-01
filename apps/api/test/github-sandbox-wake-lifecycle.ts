import { afterEach } from 'bun:test'

import { BackgroundWork } from '../src/_core/ports/background-work'

export class RecordingBackgroundWork extends BackgroundWork {
  readonly kept: Promise<unknown>[] = []

  keepAlive(work: Promise<unknown>): void {
    this.kept.push(work)
  }

  async drain(): Promise<void> {
    for (let index = 0; index < this.kept.length; index += 1) await this.kept[index]
  }
}

const created: RecordingBackgroundWork[] = []

export function trackBackground(background: RecordingBackgroundWork): void {
  if (!created.includes(background)) created.push(background)
}

async function settleEveryService(): Promise<void> {
  const settled = created.splice(0)
  await Promise.allSettled(settled.map((background) => background.drain()))
}

export function useWakeFixture(): void {
  afterEach(settleEveryService)
}
