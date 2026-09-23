import { ListItem as BaseListItem, TaskItem as BaseTaskItem } from '@tiptap/extension-list'

/** List items whose first line can be an accordion as well as a paragraph.
 *
 *  Paragraph comes first in the choice: that is what a new item is filled
 *  with, so Enter and Tab keep making plain bullets. */
const content = '(paragraph | accordion) block*'

export const ListItem = BaseListItem.extend({ content })

export const TaskItem = BaseTaskItem.extend({ content }).configure({ nested: true })
