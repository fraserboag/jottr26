import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { filterCommands, lastDeletedPage, paletteCommands, parsePaletteQuery } from '@/components/workspace/commands'
import type { PageRow } from '@/lib/db/schema'

const page: PageRow = {
  id: 'note', workspaceId: 'work', workspaceDeletionId: '', title: 'Meeting notes',
  parentId: '', sortKey: 'a0', isFavorite: 0, deletedAt: 0,
  createdAt: 0, updatedAt: 0, serverUpdatedAt: 0, dirty: 0, origin: 'local',
}

describe('command palette', () => {
  it('searches notes by default and reserves a leading / for commands', () => {
    assert.deepEqual(parsePaletteQuery(''), { mode: 'notes', text: '' })
    assert.deepEqual(parsePaletteQuery('settings'), { mode: 'notes', text: 'settings' })
    assert.deepEqual(parsePaletteQuery('Meeting / agenda'), { mode: 'notes', text: 'Meeting / agenda' })
    assert.deepEqual(parsePaletteQuery('/'), { mode: 'commands', text: '' })
    assert.deepEqual(parsePaletteQuery('/settings'), { mode: 'commands', text: 'settings' })
    assert.deepEqual(parsePaletteQuery('  /  settings'), { mode: 'commands', text: 'settings' })

    const commands = paletteCommands(page, 'Work')
    assert.deepEqual(filterCommands(commands, parsePaletteQuery('/ settings').text).map((command) => command.id), ['settings'])
  })

  it('keeps navigation and creation available without offering actions on a missing note', () => {
    const commands = paletteCommands(null, 'Work')
    assert.deepEqual(commands.map((command) => command.id), ['new-page', 'settings', 'theme', 'toggle-spaces', 'trash'])
    assert.equal(commands.find((command) => command.id === 'new-page')?.description, 'Work')

    const noteCommands = paletteCommands(page, 'Work')
    for (const id of ['new-subpage', 'favorite', 'trash-page']) {
      assert.equal(noteCommands.find((command) => command.id === id)?.description, 'Meeting notes')
    }
  })

  it('describes the favourite action using the current note state, including untitled pages', () => {
    const favorite = (note: PageRow) => paletteCommands(note, 'Work').find((command) => command.id === 'favorite')!
    assert.equal(favorite(page).label, 'Add to favourites')
    assert.equal(favorite({ ...page, isFavorite: 1 }).label, 'Remove from favourites')
    assert.equal(favorite({ ...page, title: '' }).description, 'Untitled')
  })

  it('offers empty trash only when there are items and finds it independently of moving a note to trash', () => {
    assert.equal(paletteCommands(page, 'Work', { trashCount: 0 }).some((command) => command.id === 'empty-trash'), false)
    const commands = paletteCommands(null, 'Work', { trashCount: 2 })
    const matches = filterCommands(commands, parsePaletteQuery('/ empty trash').text)
    assert.deepEqual(matches.map((command) => command.id), ['empty-trash'])
    assert.equal(matches[0].description, 'Permanently delete 2 items')
    assert.deepEqual(filterCommands(commands, 'clear bin').map((command) => command.id), ['empty-trash'])
  })

  it('offers restoration only for an available deleted note and previews its title', () => {
    assert.equal(paletteCommands(null, 'Work').some((command) => command.id === 'restore-last-deleted'), false)
    const deleted = { ...page, deletedAt: 10 }
    const commands = paletteCommands(null, 'Work', { trashCount: 1, lastDeleted: deleted })
    const matches = filterCommands(commands, 'restore last deleted')
    assert.deepEqual(matches.map((command) => command.id), ['restore-last-deleted'])
    assert.equal(matches[0].description, page.title)
    assert.equal(filterCommands(commands, 'restore')[0].id, 'restore-last-deleted')
    assert.equal(filterCommands(commands, 'theme')[0].id, 'theme')
  })

  it('restores the root of the latest deletion when its subpages share the same timestamp', () => {
    const parent = { ...page, id: 'parent', deletedAt: 20 }
    const child = { ...page, id: 'child', parentId: parent.id, deletedAt: 20 }
    assert.equal(lastDeletedPage([child, { ...page, deletedAt: 10 }, parent])?.id, parent.id)
    const newer = { ...page, id: 'newer', deletedAt: 30 }
    assert.equal(lastDeletedPage([parent, child, newer])?.id, newer.id)
    assert.equal(lastDeletedPage([]), null)
    assert.equal(lastDeletedPage([page]), null)
  })

  it('finds commands by common synonyms, spelling variants, and multiple search terms', () => {
    const commands = paletteCommands(page, 'Work')
    const find = (query: string) => filterCommands(commands, query).map((command) => command.id)
    assert.deepEqual(find('  NEW   note '), ['new-page', 'new-subpage'])
    assert.deepEqual(find('toggle favorite'), ['favorite'])
    assert.deepEqual(find('toggle favourite'), ['favorite'])
    assert.deepEqual(find('preferences'), ['settings'])
    assert.deepEqual(find('open trash'), ['trash'])
    assert.deepEqual(find('restore'), ['trash'])
    assert.deepEqual(find('no matching command'), [])
  })
})
