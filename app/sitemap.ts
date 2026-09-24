import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/util/site'

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE_URL.href, changeFrequency: 'monthly', priority: 1 }]
}
