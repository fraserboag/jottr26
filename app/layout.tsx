import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'Jottr', template: '%s · Jottr' },
  description:
    'A fast, private notebook. Your pages are stored on your device and synced to your account, so writing never waits for the network.',
  applicationName: 'Jottr',
  appleWebApp: { capable: true, title: 'Jottr', statusBarStyle: 'black-translucent' },
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  formatDetection: { telephone: false },
  // Next emits only the unprefixed `mobile-web-app-capable` for `capable`, and
  // iOS ignores the status bar style above without Apple's own tag.
  other: { 'apple-mobile-web-app-capable': 'yes' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#fbf9f4',
  colorScheme: 'light',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
