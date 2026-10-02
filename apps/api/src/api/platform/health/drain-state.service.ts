import { Injectable } from '@nestjs/common'

@Injectable()
export class DrainStateService {
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
