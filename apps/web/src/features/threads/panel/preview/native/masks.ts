import { CLIP_SELECTOR } from './clip'

export const OVERLAY_SELECTORS = [
  '[data-slot=dropdown-menu-content]',
  '[data-slot=popover-content]',
  '[data-slot=tooltip-content]',
].join(',')

export const MODAL_SELECTORS = [
  '[data-slot=dialog-content]',
  '[data-slot=alert-dialog-content]',
  '[data-slot=sheet-content]',
  '[data-slot=drawer-content]',
].join(',')

export const OVERLAY_MASKS = `${OVERLAY_SELECTORS},${CLIP_SELECTOR}`

export type OverlayState = { hidden: boolean; masks: string }

export function overlayStateOf(args: {
  root: Pick<Document, 'querySelectorAll'>
  slot: Element | undefined
}): OverlayState {
  const modals = [...args.root.querySelectorAll(MODAL_SELECTORS)]
  const slot = args.slot ?? null
  return { hidden: modals.some((modal) => !modal.contains(slot)), masks: OVERLAY_MASKS }
}

export function createMaskSync(sync: () => void): (signature: string) => void {
  let last = ''
  return (signature) => {
    if (signature === last) return
    last = signature
    sync()
  }
}
