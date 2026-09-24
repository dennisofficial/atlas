/**
 * @opentui/core 0.4.5's `waitFor` and `waitForFrame` give up the moment the scheduler reports no
 * running, rendering or scheduled work, so neither can span an await the renderer knows nothing
 * about — a scripted model step, a summariser delay, a store commit. Polling the captured frame
 * with a yield in between is what covers that gap.
 */

const POLL_MS = 5

const CEILING_MS = 10_000

export type Capturable = {
  flush: () => Promise<void>
  captureCharFrame: () => string
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @opentui/core 0.5.9's `flush` throws `Timed out waiting for visual idle` when the renderer stays
 * busy for 20 straight frames, and a live shimmer ticker keeps every frame busy on a starved
 * runner. For a polling wait a busy frame is an ordinary frame — capture it and keep going; the
 * wall-clock deadline is still the bound.
 */
const busyIsAFrame = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('visual idle')

async function flushTolerant(setup: Capturable): Promise<void> {
  try {
    await setup.flush()
  } catch (error) {
    if (!busyIsAFrame(error)) throw error
  }
}

export async function frameWhen(args: {
  setup: Capturable
  holds: (frame: string) => boolean
  within?: number
  describe?: string
}): Promise<string> {
  const deadline = Date.now() + (args.within ?? CEILING_MS)

  for (;;) {
    await flushTolerant(args.setup)
    const frame = args.setup.captureCharFrame()
    if (args.holds(frame)) return frame

    if (Date.now() >= deadline) {
      const wanted = args.describe ?? 'the frame to settle'
      throw new Error(`waited past ${args.within ?? CEILING_MS} ms for ${wanted}\n\n${frame}`)
    }

    await pause(POLL_MS)
  }
}

const STEADY_CAPTURES = 2

export async function frameSettled(args: { setup: Capturable; within?: number }): Promise<string> {
  const deadline = Date.now() + (args.within ?? CEILING_MS)
  let previous: string | undefined
  let steady = 1

  for (;;) {
    await flushTolerant(args.setup)
    const frame = args.setup.captureCharFrame()

    if (frame === previous) {
      steady += 1
      if (steady >= STEADY_CAPTURES) return frame
    } else {
      steady = 1
      previous = frame
    }

    if (Date.now() >= deadline) return frame

    await pause(POLL_MS)
  }
}

export function frameShowing(args: {
  setup: Capturable
  text: string
  within?: number
}): Promise<string> {
  return frameWhen({
    setup: args.setup,
    holds: (frame) => frame.includes(args.text),
    ...(args.within === undefined ? {} : { within: args.within }),
    describe: `${JSON.stringify(args.text)} to appear`,
  })
}
