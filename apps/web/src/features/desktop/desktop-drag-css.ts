// Chromium hands a drag region to the window as titlebar, so the page inside it receives no
// pointer events at all; a scrolling list must never be one.
export const NO_DRAG_SELECTORS = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  'summary',
  '[role=button]',
  '[role=tab]',
  '[role=menuitem]',
  '[role=combobox]',
  '[contenteditable]',
  '[data-slot=sidebar-content]',
].join(',')

export const DRAG_SELECTORS = [
  'html[data-desktop] header[data-chrome]',
  'html[data-desktop] [data-slot=sidebar-inner]',
  'html[data-desktop] [data-desktop-drag-strip]',
  'html[data-desktop] [data-desktop-drag]',
]

export const DESKTOP_DRAG_ATTRIBUTE = 'data-atlas-drag'

export const DESKTOP_DRAG_CSS = [
  ...DRAG_SELECTORS.map((selector) => `${selector}{-webkit-app-region:drag}`),
  `html[data-desktop] :is(${NO_DRAG_SELECTORS}){-webkit-app-region:no-drag}`,
].join('\n')
