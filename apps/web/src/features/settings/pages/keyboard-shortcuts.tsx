'use client'

import { SearchIcon } from 'lucide-react'
import { useState } from 'react'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@dltech/atlas-ui/components/input-group'

import { SHORTCUT_SECTIONS } from '../fixtures/settings-interface'
import { ShortcutSectionCard } from '../parts/interface-shortcut-section'
import { SettingsCard, SettingsPage } from '../settings-layout'

export function KeyboardShortcutsPage() {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const sections = SHORTCUT_SECTIONS.map((section) => ({
    ...section,
    shortcuts: section.shortcuts.filter((shortcut) =>
      shortcut.action.toLowerCase().includes(needle),
    ),
  })).filter((section) => section.shortcuts.length > 0)

  return (
    <SettingsPage
      title="Keyboard Shortcuts"
      description="Every shortcut available in Atlas."
      actions={
        <InputGroup className="w-56">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search shortcuts…"
            aria-label="Search shortcuts"
          />
        </InputGroup>
      }
    >
      {sections.length === 0 ? (
        <SettingsCard>
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No shortcuts match “{query}”.
          </p>
        </SettingsCard>
      ) : (
        sections.map((section) => <ShortcutSectionCard key={section.title} section={section} />)
      )}
    </SettingsPage>
  )
}
