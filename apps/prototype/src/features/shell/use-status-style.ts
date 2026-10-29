import { useSearchParams } from 'next/navigation'

import { EStatusStyle } from './shell-tweaks'

const STYLES: readonly string[] = Object.values(EStatusStyle)

export function useStatusStyle(): EStatusStyle {
  const raw = useSearchParams().get('statusStyle')
  return raw !== null && STYLES.includes(raw) ? (raw as EStatusStyle) : EStatusStyle.Dot
}
