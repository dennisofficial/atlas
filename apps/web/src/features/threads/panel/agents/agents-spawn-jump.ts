const FLASH_MS = 1800

const FLASH_FRAMES: Keyframe[] = [
  { boxShadow: '0 0 0 2px var(--ring)' },
  { boxShadow: '0 0 0 2px transparent' },
]

export type SpawnTarget = Pick<HTMLElement, 'scrollIntoView' | 'animate'>

export type SpawnLookup = (domId: string) => SpawnTarget | null

export const spawnDomId = (agentId: string): string => `agent-spawn-${agentId}`

export function jumpToSpawn(args: { agentId: string; lookup: SpawnLookup }): boolean {
  const target = args.lookup(spawnDomId(args.agentId))
  if (target === null) return false
  target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  target.animate(FLASH_FRAMES, { duration: FLASH_MS, easing: 'ease-out' })
  return true
}

export const documentLookup: SpawnLookup = (domId) => document.getElementById(domId)
