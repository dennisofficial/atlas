import { useState } from 'react'

export function useFollowActive(active: boolean) {
  const [open, setOpen] = useState(active)
  const [seenActive, setSeenActive] = useState(active)

  if (seenActive !== active) {
    setSeenActive(active)
    setOpen(active)
  }

  const handleToggle = () => setOpen((current) => !current)
  return { open, handleToggle }
}
