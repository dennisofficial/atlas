export enum ETheme {
  Dark = "dark",
  Light = "light",
  System = "system",
}

export enum EDensity {
  Comfortable = "comfortable",
  Compact = "compact",
}

export type AppearanceSettings = {
  theme: ETheme;
  density: EDensity;
  codeFontSize: string;
  showDiffStat: boolean;
  reduceMotion: boolean;
};

export const APPEARANCE_DEFAULTS: AppearanceSettings = {
  theme: ETheme.Dark,
  density: EDensity.Comfortable,
  codeFontSize: "13",
  showDiffStat: true,
  reduceMotion: false,
};

export const CODE_FONT_SIZES = [
  { value: "12", label: "12 px" },
  { value: "13", label: "13 px" },
  { value: "14", label: "14 px" },
];

export enum ENotifyChannel {
  InApp = "inApp",
  Push = "push",
  Email = "email",
}

export type NotifyEvent = { id: string; title: string; description: string };

export const NOTIFY_EVENTS: NotifyEvent[] = [
  { id: "finished", title: "Thread finished", description: "The agent completed its turn." },
  { id: "approval", title: "Waiting for approval", description: "A tool call needs your go-ahead." },
  { id: "errored", title: "Thread errored", description: "The turn stopped on a failure." },
  { id: "checks", title: "PR checks failed", description: "CI went red on a thread's pull request." },
  { id: "mention", title: "Mentioned by a teammate", description: "Someone @-mentioned you in a thread." },
  { id: "paused", title: "Sandbox auto-paused", description: "A sandbox idled out and was paused." },
];

export type NotifyMatrix = Record<string, Record<ENotifyChannel, boolean>>;

export type ChannelState = { push: boolean; email: boolean };

export type NotificationSettings = {
  channels: ChannelState;
  matrix: NotifyMatrix;
  quietHours: boolean;
  quietFrom: string;
  quietTo: string;
};

export const NOTIFICATION_DEFAULTS: NotificationSettings = {
  channels: { push: true, email: true },
  matrix: {
    finished: { inApp: true, push: true, email: false },
    approval: { inApp: true, push: true, email: true },
    errored: { inApp: true, push: true, email: true },
    checks: { inApp: true, push: false, email: true },
    mention: { inApp: true, push: true, email: true },
    paused: { inApp: true, push: false, email: false },
  },
  quietHours: true,
  quietFrom: "22:00",
  quietTo: "07:00",
};

export const QUIET_HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => {
  const value = `${String(hour).padStart(2, "0")}:00`;
  return { value, label: value };
});
