import { ApplicationMenu } from 'electrobun/main'

export enum EMenuAction {
  Settings = 'open-settings',
  Reload = 'reload',
  ToggleDevTools = 'toggle-devtools',
}

export function installApplicationMenu(): void {
  ApplicationMenu.setApplicationMenu([
    {
      label: 'Atlas',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', action: EMenuAction.Settings, accelerator: ',' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'showAll' },
        { type: 'separator' },
        { role: 'quit' },
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
        { role: 'toggleFullScreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }],
    },
  ])
}
