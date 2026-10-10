import { describe, it } from 'bun:test'

describe.skip('a mid-turn lift', () => {
  // slice 08: interrupting a running turn and resuming it on the sandbox is the lift's mid-turn
  // handoff, and /container no longer drives a lift. Steering a turn that already runs in the
  // cloud is covered in app-cloud-steering.spec.tsx.
  it('interrupts a turn in flight, lifts it, and resumes it in the cloud without being asked', () => {})
})
