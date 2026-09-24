import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/util/site'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Client-rendered shells: to a crawler they are a spinner and a redirect.
      disallow: ['/app', '/login'],
    },
    sitemap: new URL('/sitemap.xml', SITE_URL).href,
  }
}
