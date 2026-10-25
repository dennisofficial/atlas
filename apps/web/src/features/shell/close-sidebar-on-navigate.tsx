'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

import { useSidebar } from '@dltech/atlas-ui/components/sidebar'

export function CloseSidebarOnNavigate() {
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()
  useEffect(() => {
    setOpenMobile(false)
  }, [pathname, setOpenMobile])
  return null
}
