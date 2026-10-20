export enum EDeviceKind {
  Browser = "browser",
  Cli = "cli",
  Sandbox = "sandbox",
}

export type SignedInDevice = {
  id: string;
  kind: EDeviceKind;
  name: string;
  meta: string;
  current: boolean;
};

export const SIGNED_IN_DEVICES: SignedInDevice[] = [
  {
    id: "dev_chrome",
    kind: EDeviceKind.Browser,
    name: "Chrome on macOS",
    meta: "73.162.40.18 · San Francisco, US · Last active now",
    current: true,
  },
  {
    id: "dev_tui",
    kind: EDeviceKind.Cli,
    name: "atlas TUI · dennis-mbp",
    meta: "73.162.40.18 · San Francisco, US · Last active 2m ago",
    current: false,
  },
  {
    id: "dev_safari",
    kind: EDeviceKind.Browser,
    name: "Safari on iPhone",
    meta: "172.58.12.201 · Oakland, US · Last active 3h ago",
    current: false,
  },
  {
    id: "dev_serve",
    kind: EDeviceKind.Sandbox,
    name: "atlas-serve · sandbox sb-1evx",
    meta: "iad1 · vercel · Last active 12m ago",
    current: false,
  },
  {
    id: "dev_cli_ci",
    kind: EDeviceKind.Cli,
    name: "atlas CLI · build-runner-04",
    meta: "34.121.8.77 · Council Bluffs, US · Last active 2d ago",
    current: false,
  },
];

export const PENDING_DEVICE_CODE = {
  code: "WDJB-MJHT",
  requested: "Requested 1m ago from atlas TUI",
  origin: "dennis-mbp · 73.162.40.18",
};

export type SignInEvent = {
  id: string;
  event: string;
  device: string;
  ip: string;
  time: string;
};

export const SIGN_IN_ACTIVITY: SignInEvent[] = [
  { id: "ev_1", event: "Device code approved", device: "atlas TUI · dennis-mbp", ip: "73.162.40.18", time: "2m ago" },
  { id: "ev_2", event: "Signed in", device: "Chrome on macOS", ip: "73.162.40.18", time: "26m ago" },
  { id: "ev_3", event: "Sandbox token issued", device: "atlas-serve · sandbox sb-1evx", ip: "iad1", time: "12m ago" },
  { id: "ev_4", event: "Signed in", device: "Safari on iPhone", ip: "172.58.12.201", time: "3h ago" },
  { id: "ev_5", event: "Session revoked", device: "Firefox on Windows", ip: "98.45.221.6", time: "Yesterday" },
  { id: "ev_6", event: "Device code approved", device: "atlas CLI · build-runner-04", ip: "34.121.8.77", time: "2d ago" },
];
