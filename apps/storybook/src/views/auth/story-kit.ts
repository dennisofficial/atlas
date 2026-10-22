export function demoArgType(options: string[]) {
  return { control: "select", options } as const;
}

export const FULLSCREEN = { layout: "fullscreen" } as const;
