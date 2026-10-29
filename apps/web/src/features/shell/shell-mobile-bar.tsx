import Link from 'next/link'
import { PlusIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { SidebarTrigger } from '@dltech/atlas-ui/components/sidebar'

import { AtlasMark } from './atlas-mark'

export function ShellMobileBar() {
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b px-2 md:hidden">
      <SidebarTrigger aria-label="Open navigation" size="icon-lg" />
      <Link href="/threads" className="flex items-center gap-2 px-1 text-sm font-medium">
        <AtlasMark className="size-5" />
        Atlas
      </Link>
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="New thread"
        nativeButton={false}
        render={<Link href="/threads/new" />}
        className="ml-auto"
      >
        <PlusIcon />
      </Button>
    </header>
  )
}
