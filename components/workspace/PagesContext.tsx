'use client'

import { createContext, useContext } from 'react'
import type { PageRow } from '@/lib/db/schema'

/** The live page list, read once by the workspace and shared, rather than each
 *  part of the app that needs it running its own copy of the same query. */
export const PagesContext = createContext<PageRow[]>([])

export function usePages() {
  return useContext(PagesContext)
}
