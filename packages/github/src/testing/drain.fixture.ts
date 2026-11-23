import type { GithubDrain } from '../github-ports'

export class RecordingDrain implements GithubDrain {
  private draining = false
  private readonly listeners = new Set<() => void>()

  beginDrain(): void {
    if (this.draining) return
    this.draining = true
    for (const listener of this.listeners) listener()
  }

  isDraining(): boolean {
    return this.draining
  }

  onDrain(listener: () => void): void {
    this.listeners.add(listener)
  }
}

export const inertDrain = (): GithubDrain => ({ onDrain: () => undefined })
