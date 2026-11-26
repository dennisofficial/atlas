export type StepEvent =
  | { kind: 'in-flight'; scopeKey: string; stepKey: string }
  | { kind: 'settled'; scopeKey: string; stepKey: string; handedOff: boolean }

export class InFlightSteps {
  private readonly byScope = new Map<string, Set<string>>()

  apply(event: StepEvent): void {
    if (event.kind === 'in-flight') {
      this.stepsOf(event.scopeKey).add(event.stepKey)
      return
    }
    if (event.handedOff) return
    this.byScope.get(event.scopeKey)?.delete(event.stepKey)
  }

  detached(scopeKey: string): boolean {
    return (this.byScope.get(scopeKey)?.size ?? 0) > 0
  }

  private stepsOf(scopeKey: string): Set<string> {
    const held = this.byScope.get(scopeKey) ?? new Set<string>()
    this.byScope.set(scopeKey, held)
    return held
  }
}
