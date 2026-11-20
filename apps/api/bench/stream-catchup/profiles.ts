export type RandomStall = { probabilityPerSecond: number; minMs: number; maxMs: number }

export type FixedStall = { afterMs: number; ms: number }

export type LinkProfile = {
  name: string
  latencyMs: number
  bytesPerSecond: number | undefined
  randomStall: RandomStall | undefined
  fixedStall: FixedStall | undefined
}

const BITS_PER_BYTE = 8

const bytesPerSecondOf = (megabitsPerSecond: number): number =>
  Math.round((megabitsPerSecond * 1_000_000) / BITS_PER_BYTE)

export const PROFILES: readonly LinkProfile[] = [
  {
    name: 'fast',
    latencyMs: 0,
    bytesPerSecond: undefined,
    randomStall: undefined,
    fixedStall: undefined,
  },
  {
    name: 'wifi-flaky',
    latencyMs: 20,
    bytesPerSecond: bytesPerSecondOf(50),
    randomStall: { probabilityPerSecond: 0.02, minMs: 3_000, maxMs: 10_000 },
    fixedStall: undefined,
  },
  {
    name: 'slow',
    latencyMs: 150,
    bytesPerSecond: bytesPerSecondOf(2),
    randomStall: undefined,
    fixedStall: undefined,
  },
  {
    name: 'stall',
    latencyMs: 20,
    bytesPerSecond: bytesPerSecondOf(50),
    randomStall: undefined,
    fixedStall: { afterMs: 500, ms: 60_000 },
  },
]

export const profilesNamed = (names: readonly string[]): readonly LinkProfile[] => {
  const chosen = names.map((name) => {
    const profile = PROFILES.find((candidate) => candidate.name === name)
    if (profile === undefined) throw new Error(`unknown profile ${name}`)
    return profile
  })
  return chosen
}

export const PROFILE_NAMES = PROFILES.map((profile) => profile.name)
