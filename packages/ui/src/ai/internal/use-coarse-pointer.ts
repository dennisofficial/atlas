import { useEffect, useState } from 'react'

const COARSE_POINTER = '(pointer: coarse)'

export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false)
  useEffect(() => {
    const query = window.matchMedia(COARSE_POINTER)
    const onChange = () => setCoarse(query.matches)
    query.addEventListener('change', onChange)
    onChange()
    return () => query.removeEventListener('change', onChange)
  }, [])
  return coarse
}
