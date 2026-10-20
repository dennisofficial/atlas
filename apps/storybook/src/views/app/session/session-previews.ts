export enum EPreviewStatus {
  Live = "live",
  Starting = "starting",
  Stopped = "stopped",
}

export interface PreviewUrl {
  id: string;
  port: number;
  label: string;
  url: string;
  status: EPreviewStatus;
}

export const PREVIEW_URLS: PreviewUrl[] = [
  {
    id: "storybook",
    port: 6006,
    label: "Storybook",
    url: "https://6006-thr-ui-rebase.preview.atlas.dev",
    status: EPreviewStatus.Live,
  },
  {
    id: "web",
    port: 3000,
    label: "Web app",
    url: "https://3000-thr-ui-rebase.preview.atlas.dev",
    status: EPreviewStatus.Starting,
  },
  {
    id: "api",
    port: 4000,
    label: "API",
    url: "https://4000-thr-ui-rebase.preview.atlas.dev",
    status: EPreviewStatus.Stopped,
  },
];
