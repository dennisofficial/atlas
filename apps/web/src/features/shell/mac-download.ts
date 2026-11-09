import { z } from 'zod'

import { isDesktopHost } from '@/features/desktop/desktop-attributes'

export const MAC_DOWNLOAD_URL =
  'https://github.com/dennisofficial/atlas/releases/latest/download/macos-arm64-Atlas.dmg'

const AGENT_SCHEMA = z.object({
  userAgent: z.string(),
  maxTouchPoints: z.number().optional(),
})

const AGENT_DATA_SCHEMA = z.object({ platform: z.string().optional() })

interface BrowserSignals {
  userAgent: string
  platform: string | undefined
  maxTouchPoints: number
}

export function isMacBrowser({ userAgent, platform, maxTouchPoints }: BrowserSignals): boolean {
  if (maxTouchPoints > 1) return false
  if (platform === 'macOS') return true
  return /Macintosh|Mac OS X/.test(userAgent) && !/iPhone|iPad/.test(userAgent)
}

export function macDownloadHref(host: object): string | null {
  if (isDesktopHost(host)) return null
  const navigator = Reflect.get(host, 'navigator')
  const agent = AGENT_SCHEMA.safeParse(navigator)
  if (!agent.success) return null
  const data = AGENT_DATA_SCHEMA.safeParse(Reflect.get(navigator, 'userAgentData'))
  const mac = isMacBrowser({
    userAgent: agent.data.userAgent,
    platform: data.success ? data.data.platform : undefined,
    maxTouchPoints: agent.data.maxTouchPoints ?? 0,
  })
  return mac ? MAC_DOWNLOAD_URL : null
}
