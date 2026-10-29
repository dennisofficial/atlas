'use client'

import Link from 'next/link'
import { ArrowLeftIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'

import { useReturnPath } from '../shell/return-path'

export function SettingsTopBar() {
  const backHref = useReturnPath()
  return (
    <header
      data-chrome="titlebar-start"
      className="flex h-12 shrink-0 items-center gap-2 border-b px-3 md:grid md:grid-cols-[1fr_auto_1fr]"
    >
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 text-muted-foreground md:justify-self-start"
        nativeButton={false}
        render={<Link href={backHref} />}
      >
        <ArrowLeftIcon data-icon="inline-start" />
        <span className="sr-only sm:not-sr-only">Back to Atlas</span>
      </Button>
      <p className="hidden text-sm font-medium md:block">Settings</p>
      <span className="hidden md:block" />
    </header>
  )
}
