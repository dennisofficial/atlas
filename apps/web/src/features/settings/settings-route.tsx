'use client'

import { SettingsShell } from './settings-shell'
import { renderSettingsPage } from './settings-pages'
import type { ESettingsPage } from './settings-nav'

export function SettingsRoute({ page }: { page: ESettingsPage }) {
  return <SettingsShell page={page} renderPage={renderSettingsPage} />
}
