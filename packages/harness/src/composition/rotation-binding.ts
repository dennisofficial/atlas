import { RotationPort, type RotationListener, type RotationOutcome } from '../rotation'

/**
 * The rotation port is registered before surfaces bind (serve reads it out of the container during
 * `surface.bind`), but the real orchestrator needs the event log and thread store the composition
 * root builds afterwards. This slot is the stable instance the container hands out; the root points
 * it at the real LocalRotation once those exist. Surfaces call its methods only at runtime, never
 * during bind, so the delegation is always live by the time it is used.
 */
export class LateRotation extends RotationPort {
  private inner: RotationPort | undefined

  bind(rotation: RotationPort): void {
    if (this.inner !== undefined) throw new Error('the rotation port is already bound')
    this.inner = rotation
  }

  private require(): RotationPort {
    if (this.inner === undefined) throw new Error('the rotation port was never bound to an orchestrator')
    return this.inner
  }

  request(args: Parameters<RotationPort['request']>[0]): Promise<RotationOutcome> {
    return this.require().request(args)
  }

  subscribe(listener: RotationListener): () => void {
    return this.require().subscribe(listener)
  }
}
