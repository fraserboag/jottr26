import type { IconName } from '@/components/ui/Icon'
import type { PageRow } from '@/lib/db/schema'

export type PaletteMode = 'notes' | 'commands'

/** Recognise a typed or pasted prefix before storing the visible input text. */
export function parsePaletteQuery(query: string): { mode: PaletteMode; text: string } {
  const value = query.trimStart()
  return value.startsWith('/')
    ? { mode: 'commands', text: value.slice(1).trimStart() }
    : { mode: 'notes', text: value }
}

export interface PaletteCommand {
  id: 'new-page' | 'new-subpage' | 'favorite' | 'trash-page' | 'settings' | 'theme' | 'toggle-spaces' | 'trash' | 'empty-trash' | 'restore-last-deleted'
  label: string
  icon: IconName
  description?: string
  keywords: string
}

/** Page actions always refer to the note open behind the palette. */
export function paletteCommands(page: PageRow | null, spaceName: string, {
  trashCount = 0, inline = false, lastDeleted = null,
}: { trashCount?: number; inline?: boolean; lastDeleted?: PageRow | null } = {}): PaletteCommand[] {
  const commands: PaletteCommand[] = [{
    id: 'new-page', label: 'Create a new page', icon: 'filePlus',
    description: spaceName, keywords: 'add create new note page',
  }]

  if (page) {
    const description = page.title || 'Untitled'
    commands.push(
      { id: 'new-subpage', label: 'Create a new subpage', icon: 'subpages', description, keywords: 'add create new child nested note page subpage' },
      { id: 'favorite', label: page.isFavorite ? 'Remove from favourites' : 'Add to favourites', icon: 'star', description, keywords: 'toggle favorite favourite star unstar' },
      { id: 'trash-page', label: 'Move page to trash', icon: 'trash', description, keywords: 'delete remove current note page trash' },
    )
  }

  commands.push(
    { id: 'settings', label: 'Open settings', icon: 'settings', keywords: 'settings preferences appearance theme account spaces' },
    { id: 'theme', label: 'Change theme', icon: 'settings', keywords: 'change theme appearance light dark system automatic' },
    {
      id: 'toggle-spaces', icon: 'panel',
      label: inline ? 'Show one space at a time' : 'Show all spaces simultaneously',
      description: `Show all spaces simultaneously: ${inline ? 'On' : 'Off'}`,
      keywords: 'toggle show all spaces simultaneously single one multiple workspaces sidebar visibility layout',
    },
    { id: 'trash', label: 'Open trash', icon: 'trash', keywords: 'trash deleted restore bin' },
  )
  if (lastDeleted) {
    commands.push({
      id: 'restore-last-deleted', label: 'Restore last deleted note', icon: 'undo',
      description: lastDeleted.title || 'Untitled', keywords: 'restore last deleted trashed note page undo deletion recover',
    })
  }
  if (trashCount > 0) {
    commands.push({
      id: 'empty-trash', label: 'Empty trash', icon: 'trash',
      description: `Permanently delete ${trashCount} ${trashCount === 1 ? 'item' : 'items'}`,
      keywords: 'empty trash clear bin permanently delete remove deleted notes pages',
    })
  }
  return commands
}

/** Subpages share their parent's deletion time. Restore the parent rather
 *  than whichever child happens to sort first in the trash query. */
export function lastDeletedPage(pages: readonly PageRow[]): PageRow | null {
  let latest: PageRow | null = null
  for (const page of pages) {
    if (page.deletedAt > (latest?.deletedAt ?? 0)) latest = page
  }
  if (!latest) return null
  const byId = new Map(pages.map((page) => [page.id, page]))
  const seen = new Set([latest.id])
  let parent = byId.get(latest.parentId)
  while (parent && !seen.has(parent.id) && parent.workspaceId === latest.workspaceId
    && parent.deletedAt === latest.deletedAt && parent.workspaceDeletionId === latest.workspaceDeletionId) {
    seen.add(parent.id)
    latest = parent
    parent = byId.get(parent.parentId)
  }
  return latest
}

export function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const score = (command: PaletteCommand) => {
    const label = command.label.toLowerCase()
    return terms.filter((term) => label.includes(term)).length
      + (terms.length > 0 && label.startsWith(terms.join(' ')) ? 2 : 0)
  }
  return commands.filter((command) => {
    const text = `${command.label} ${command.keywords}`.toLowerCase()
    return terms.every((term) => text.includes(term))
  }).sort((a, b) => score(b) - score(a))
}
