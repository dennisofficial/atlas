const INTERACTIVE = [
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
].join(',')

export const DESKTOP_DRAG_ATTRIBUTE = 'data-atlas-drag'

export const DESKTOP_DRAG_CSS = [
  'html[data-desktop] header[data-chrome]{-webkit-app-region:drag}',
  'html[data-desktop] [data-slot=sidebar-inner]{-webkit-app-region:drag}',
  'html[data-desktop] [data-desktop-drag-strip]{-webkit-app-region:drag}',
  `html[data-desktop] :is(${INTERACTIVE}){-webkit-app-region:no-drag}`,
].join('\n')
