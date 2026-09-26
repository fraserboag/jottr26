/** Scrolls a list just far enough to show one of its rows. `scrollIntoView`
 *  would scroll every ancestor too, and on a phone that includes the visual
 *  viewport, which drags the page about under the keyboard. */
export function scrollIntoList(list: HTMLElement, row: HTMLElement) {
  if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop
  else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
    list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight
  }
}
