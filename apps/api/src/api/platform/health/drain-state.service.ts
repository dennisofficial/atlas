import { Injectable } from '@nestjs/common'

@Injectable()
export class DrainStateService {
  private draining = false

  beginDrain(): void {
    this.draining = true
  }

  isDraining(): boolean {
    return this.draining
  }
}
