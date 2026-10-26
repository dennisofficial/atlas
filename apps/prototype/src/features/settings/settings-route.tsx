'use client'

import type { ESettingsPage } from './settings-nav'
import { renderSettingsPage } from './settings-pages'
import { SettingsShell } from './settings-shell'

export function SettingsRoute({ page }: { page: ESettingsPage }) {
  return <SettingsShell page={page} renderPage={renderSettingsPage} />
}
