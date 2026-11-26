export class InFlightSteps {
  private readonly calls = new Set<string>()

  mark(args: { callKey: string; step: boolean }): void {
    if (args.step) {
      this.calls.add(args.callKey)
      return
    }
    this.calls.delete(args.callKey)
  }

  detached(callKey: string): boolean {
    return this.calls.has(callKey)
  }
}
