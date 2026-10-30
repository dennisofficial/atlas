import { ApplicationMenu } from 'electrobun/main'

export enum EMenuAction {
  Settings = 'open-settings',
  Reload = 'reload',
  ToggleDevTools = 'toggle-devtools',
}

// Electrobun assigns default key equivalents only to edit roles, so every other role needs an
// explicit accelerator: https://github.com/blackboardsh/electrobun/blob/main/package/src/native/macos/nativeWrapper.mm
export function installApplicationMenu(): void {
  ApplicationMenu.setApplicationMenu([
    {
      label: 'Atlas',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', action: EMenuAction.Settings, accelerator: ',' },
        { type: 'separator' },
        { role: 'hide', accelerator: 'Command+H' },
        { role: 'hideOthers', accelerator: 'Command+Option+H' },
        { role: 'showAll' },
        { type: 'separator' },
        { role: 'quit', accelerator: 'Command+Q' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', action: EMenuAction.Reload, accelerator: 'r' },
        { label: 'Toggle Developer Tools', action: EMenuAction.ToggleDevTools },
        { type: 'separator' },
        { role: 'toggleFullScreen', accelerator: 'Control+Command+F' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize', accelerator: 'Command+M' },
        { role: 'zoom' },
        { role: 'close', accelerator: 'Command+W' },
      ],
    },
  ])
}
