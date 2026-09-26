/** A small hand-picked icon set, inlined.
 *
 *  An icon package would be a few hundred kilobytes of dependency for the
 *  twenty glyphs this app actually draws. These are 24×24 stroke paths in the
 *  same visual language, so they sit together cleanly at any size. */

const paths = {
  plus: 'M12 5v14M5 12h14',
  chevronRight: 'm9 6 6 6-6 6',
  chevronDown: 'm6 9 6 6 6-6',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-13M9 7V4h6v3',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9L12 3Z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  check: 'm5 13 4 4L19 7',
  cloudCheck: 'M7 18a4 4 0 0 1-.4-7.98 5.5 5.5 0 0 1 10.6-1.2A4.2 4.2 0 0 1 17.5 18H7Zm2.5-4.2 1.8 1.8 3.4-3.6',
  cloud: 'M7 18a4 4 0 0 1-.4-7.98 5.5 5.5 0 0 1 10.6-1.2A4.2 4.2 0 0 1 17.5 18H7Z',
  cloudOff: 'M3 3l18 18M7.5 18A4.5 4.5 0 0 1 7 9.03M9.6 5.6A5.5 5.5 0 0 1 17.2 8.8 4.2 4.2 0 0 1 19.4 16M11 18h6',
  refresh: 'M20 12a8 8 0 1 1-2.34-5.66L20 8.5M20 3.5v5h-5',
  alert: 'M12 8v5M12 17h.01M10.3 3.9 2.5 17.5A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  panel: 'M4 5h16v14H4zM10 5v14',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5ZM14 3v5h5',
  filePlus: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5ZM14 3v5h5M12 11.5v6M9 14.5h6',
  undo: 'M4 9h11a5 5 0 0 1 0 10h-6M4 9l4-4M4 9l4 4',
  redo: 'M20 9H9a5 5 0 0 0 0 10h6M20 9l-4-4M20 9l-4 4',
  slash: 'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3ZM14.5 7.5l-5 9',
  settings:
    'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  x: 'm6 6 12 12M18 6 6 18',
  bold: 'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z',
  italic: 'M15 5h-5M14 19H9M14.5 5 10 19',
  strike: 'M4 12h16M16.5 7.5A4 4 0 0 0 13 5.5h-1.5a3.2 3.2 0 0 0-1 6.3M7.5 16.5A4 4 0 0 0 11 18.5h1.7a3.2 3.2 0 0 0 1.3-6',
  code: 'm9 18-5-6 5-6M15 6l5 6-5 6',
  link: 'M10.5 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 1 0-5.7-5.7l-1.3 1.3M13.5 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 1 0 5.7 5.7l1.3-1.3',
  title: 'M6 5v14M18 5v14M6 12h12',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  listOrdered: 'M10 6h10M10 12h10M10 18h10M4 10h2M4 6h1v4M6 18H4c0-1 2-2 2-3s-1-1.5-2-1',
  callout:
    'M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM8 10.5h8M8 14.5h5',
  subpages:
    'M5 4h8a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM8 10v7a1 1 0 0 0 1 1h3M8 14h4M15 14h5M15 18h5',
  divider: 'M4 12h16',
  accordion:
    'M4 6.5h10M16.5 5.5l2 2 2-2M5 11h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1ZM7.5 15h7',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0',
  mail: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM3.5 6.5l8.5 6.5 8.5-6.5',
  arrowLeft: 'm12 19-7-7 7-7M19 12H5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  inbox: 'M4 13h4l1.5 3h5L16 13h4M4 13l2.4-7.4A1 1 0 0 1 7.4 5h9.2a1 1 0 0 1 1 .6L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5Z',
  download: 'M12 3v12M8 11l4 4 4-4M4 20h16',
  minus: 'M5 12h14',
  pound: 'M15.5 7.2a3 3 0 0 0-5.3 2v5.4c0 1.8-1 3.3-2.7 4.1M7.5 18.7h9.6M8.2 13h6.3',
  table:
    'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM4 9.5h16M4 15h16M9.5 4v16',
  tableHeader:
    'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM4 9.5h16M7 6.8h10M9.5 9.5v10.5',
} as const

export type IconName = keyof typeof paths

export function Icon({
  name,
  size = 16,
  className = '',
  strokeWidth = 1.7,
  filled = false,
}: {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
  filled?: boolean
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}
