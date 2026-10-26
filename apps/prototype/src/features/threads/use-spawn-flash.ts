import { useEffect, useState } from 'react'

const SCROLL_DELAY_MS = 120
const FLASH_MS = 1800

export function spawnDomId(id: string): string {
  return `subagent-${id}`
}

export function useSpawnFlash() {
  const [flashId, setFlashId] = useState<string>()

  useEffect(() => {
    if (!flashId) return undefined
    const scrollTimer = setTimeout(() => {
      document
        .getElementById(spawnDomId(flashId))
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, SCROLL_DELAY_MS)
    const clearTimer = setTimeout(() => setFlashId(undefined), FLASH_MS)
    return () => {
      clearTimeout(scrollTimer)
      clearTimeout(clearTimer)
    }
  }, [flashId])

  return { flashId, flash: setFlashId }
}
