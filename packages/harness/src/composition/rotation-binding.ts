import { RotationPort, type RotationOutcome, type RotationSettle, type RotationStatus, type RotationStage } from '../rotation'

/**
 * The rotation port is registered before surfaces bind (serve reads it out of the container during
 * `surface.bind`), but the real orchestrator needs the turn runner, which only exists after
 * `wireTurn`. This slot is the stable instance the container hands out; the composition root points
 * it at the real LocalRotation once the runner exists. Surfaces call its methods only at runtime,
 * never during bind, so the delegation is always live by the time it is used.
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

  request(args: { sessionId: string; predecessor: Parameters<RotationPort['request']>[0]['predecessor']; instructions: string; settle: RotationSettle }): Promise<RotationOutcome> {
    return this.require().request(args)
  }

  status(args: { sessionId: string }): Promise<RotationStatus> {
    return this.require().status(args)
  }

  recover(args: { sessionId: string; activate?: (() => Promise<void>) | undefined }): Promise<RotationStatus> {
    return this.require().recover(args)
  }

  subscribe(listener: (stage: RotationStage) => void): () => void {
    return this.require().subscribe(listener)
  }
}
