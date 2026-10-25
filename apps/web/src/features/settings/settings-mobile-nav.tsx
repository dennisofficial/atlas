'use client'

import { useState } from 'react'
import { MenuIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@dltech/atlas-ui/components/sheet'
import { Sidebar } from '@dltech/atlas-ui/components/sidebar'

import { SettingsNavBody } from './settings-nav-body'
import { ESettingsPage, ESettingsScope, labelOfPage } from './settings-nav'

export function SettingsMobileNav({ scope, page }: { scope: ESettingsScope; page: ESettingsPage }) {
  const [openOnPage, setOpenOnPage] = useState<ESettingsPage | null>(null)
  const open = openOnPage === page
  const handleOpenChange = (next: boolean) => setOpenOnPage(next ? page : null)
  const handleClose = () => setOpenOnPage(null)

  return (
    <div className="flex h-11 shrink-0 items-center border-b px-3 md:hidden">
      <Button
        variant="ghost"
        size="sm"
        aria-label="Settings menu"
        className="min-w-0 justify-start"
        onClick={() => setOpenOnPage(page)}
      >
        <MenuIcon data-icon="inline-start" />
        <span className="truncate">{labelOfPage(page)}</span>
      </Button>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent side="left">
          <SheetHeader>
            <SheetTitle>Settings</SheetTitle>
          </SheetHeader>
          <Sidebar collapsible="none" className="min-h-0 w-full flex-1">
            <SettingsNavBody scope={scope} page={page} onNavigate={handleClose} />
          </Sidebar>
        </SheetContent>
      </Sheet>
    </div>
  )
}
