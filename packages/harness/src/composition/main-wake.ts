export const MAX_WAKE_ATTEMPTS = 3

/**
 * The main-thread half of the idle wake, sibling to ChildWake: an ending that lands while no turn
 * is running starts one, and the turn's own drain delivers the notice. ChildWake hands the same
 * event to the supervisor for stopped sub-agents; this drives the session's own thread.
 *
 * The witness names the set of pending notices by their joined ids, so a re-render alone never
 * re-fires a wake that already went out for the same set. A turn that dies before its first drain
 * leaves the same notices pending, though, so the same witness is allowed to fire again — bounded
 * by MAX_WAKE_ATTEMPTS, which is what keeps a turn that dies instantly every time from spinning
 * here. A drained or changed witness resets the count.
 *
 * `blocked` is the surface's say over whether a turn may start at all — a running turn, or a
 * prompt that has taken the keyboard. The ending keeps until it clears.
 */
export class MainWake {
  private attempts: { witness: string | null; count: number } = { witness: null, count: 0 }

  constructor(
    private readonly args: { blocked: () => boolean; onWake: () => void },
  ) {}

  onNotice({ witness }: { witness: string | null }): void {
    if (witness === null) {
      this.attempts = { witness: null, count: 0 }
      return
    }
    if (this.args.blocked()) return

    if (this.attempts.witness !== witness) this.attempts = { witness, count: 0 }
    if (this.attempts.count >= MAX_WAKE_ATTEMPTS) return

    this.attempts = { witness, count: this.attempts.count + 1 }
    this.args.onWake()
  }
}
