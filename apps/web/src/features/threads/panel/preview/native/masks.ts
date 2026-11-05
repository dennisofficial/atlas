export const OVERLAY_MASKS = [
  '[data-slot=dropdown-menu-content]',
  '[data-slot=popover-content]',
  '[data-slot=tooltip-content]',
  '[data-slot=dialog-content]',
].join(',')

export const SHEET_MASK = '[data-slot=sheet-content]'

export const isInSheet = (element: Element | undefined): boolean =>
  element?.closest(SHEET_MASK) != null

type MaskTarget = Pick<
  import('./webview-handle').NativeWebview,
  'addMaskSelector' | 'removeMaskSelector'
>

export function syncSheetMask(args: { webview: MaskTarget; inSheet: boolean }): void {
  if (args.inSheet) args.webview.removeMaskSelector(SHEET_MASK)
  else args.webview.addMaskSelector(SHEET_MASK)
}
