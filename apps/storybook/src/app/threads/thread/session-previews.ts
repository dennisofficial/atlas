import { EPreviewStatus, type PreviewPort } from '@dltech/atlas-ui/ai/preview-frame'

const PLACEHOLDER_PAGE = `<body style="margin:0;font:13px system-ui;background:#f5f1ec;color:#2a2522;padding:16px;display:grid;gap:12px"><div style="height:12px;width:96px;background:#e4dcd2;border-radius:4px"></div><div style="height:24px;width:66%;background:#e4dcd2;border-radius:4px"></div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px"><div style="height:80px;background:#eae3db;border-radius:6px"></div><div style="height:80px;background:#eae3db;border-radius:6px"></div><div style="height:80px;background:#eae3db;border-radius:6px"></div></div></body>`

export const PREVIEW_URLS: PreviewPort[] = [
  {
    id: 'storybook',
    port: 6006,
    label: 'Storybook',
    url: 'https://6006-thr-ui-rebase.preview.atlas.dev',
    status: EPreviewStatus.Live,
    frameSrc: `data:text/html,${encodeURIComponent(PLACEHOLDER_PAGE)}`,
  },
  {
    id: 'web',
    port: 3000,
    label: 'Web app',
    url: 'https://3000-thr-ui-rebase.preview.atlas.dev',
    status: EPreviewStatus.Starting,
  },
  {
    id: 'api',
    port: 4000,
    label: 'API',
    url: 'https://4000-thr-ui-rebase.preview.atlas.dev',
    status: EPreviewStatus.Stopped,
  },
]
