'use client'

import type { ReactNode } from 'react'

import { appearanceFrom, EFileIconStyle } from '@dltech/atlas-client/settings'
import { FileIconsProvider } from '@dltech/atlas-ui/ai/file-type-icon'

import { useCloudSettings } from '@/lib/cloud-settings'

export function SettingsFileIconsProvider({ children }: { children: ReactNode }) {
  const { query } = useCloudSettings()
  const { fileIcons } = appearanceFrom(query.data ?? new Map())
  return (
    <FileIconsProvider colored={fileIcons === EFileIconStyle.Color}>{children}</FileIconsProvider>
  )
}
