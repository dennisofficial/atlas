import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Atlas Cloud',
    short_name: 'Atlas',
    start_url: '/',
    display: 'standalone',
    background_color: '#272422',
    theme_color: '#272422',
    icons: [
      { src: '/brand/atlas-icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/atlas-icon.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
