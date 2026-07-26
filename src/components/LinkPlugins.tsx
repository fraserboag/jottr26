import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { createLinkMatcherWithRegExp } from '@lexical/react/LexicalAutoLinkPlugin';
import { TOGGLE_LINK_COMMAND } from '@lexical/link';
import {
  $getSelection,
  $isRangeSelection,
  PASTE_COMMAND,
  COMMAND_PRIORITY_HIGH,
} from 'lexical';
import { useEffect } from 'react';

// Matches a URL anywhere in a run of text, but only with a protocol or a www.
// prefix — matching bare hosts too would linkify prose like "node.js".
const URL_REGEX =
  /((https?:\/\/(www\.)?)|(www\.))[-\w@:%.+~#=]{1,256}\.[a-z]{2,}\b[-\w()@:%+.~#?&/=]*/i;

const BARE_URL_REGEX = new RegExp(`^${URL_REGEX.source}$`, 'i');

const withProtocol = (text: string) =>
  text.startsWith('http') ? text : `https://${text}`;

export const URL_MATCHERS = [
  createLinkMatcherWithRegExp(URL_REGEX, withProtocol),
];

// Pasting a URL onto selected text links that text rather than replacing it.
// A paste at a plain cursor falls through to the default handling, where
// AutoLinkPlugin turns the inserted URL into a link of its own.
export function PasteLinkPlugin(): null {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          if (!(event instanceof ClipboardEvent)) return false;
          const text = event.clipboardData?.getData('text/plain').trim();
          if (!text || !BARE_URL_REGEX.test(text)) return false;
          const selection = $getSelection();
          if (
            !$isRangeSelection(selection) ||
            selection.isCollapsed() ||
            selection.getTextContent().length === 0
          ) {
            return false;
          }
          event.preventDefault();
          editor.dispatchCommand(TOGGLE_LINK_COMMAND, withProtocol(text));
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor],
  );
  return null;
}

// Opens links on cmd/ctrl+click, and shows a pointer cursor while the modifier
// is held (via a data attribute on the root that CSS keys off of). A plain
// click keeps its default behaviour of placing the cursor, so editing isn't
// hijacked. The modifier is cmd on macOS and ctrl elsewhere.
export function CmdClickLinkPlugin(): null {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a');
      if (!anchor) return;
      event.preventDefault();
      window.open(anchor.href, '_blank', 'noopener,noreferrer');
    };
    const syncModifier = (event: KeyboardEvent) => {
      const root = editor.getRootElement();
      if (!root) return;
      if (event.metaKey || event.ctrlKey) {
        root.setAttribute('data-modifier-down', 'true');
      } else {
        root.removeAttribute('data-modifier-down');
      }
    };
    const clearModifier = () =>
      editor.getRootElement()?.removeAttribute('data-modifier-down');
    window.addEventListener('keydown', syncModifier);
    window.addEventListener('keyup', syncModifier);
    window.addEventListener('blur', clearModifier);
    const unregisterRoot = editor.registerRootListener((root, prevRoot) => {
      prevRoot?.removeEventListener('click', onClick);
      root?.addEventListener('click', onClick);
    });
    return () => {
      window.removeEventListener('keydown', syncModifier);
      window.removeEventListener('keyup', syncModifier);
      window.removeEventListener('blur', clearModifier);
      unregisterRoot();
    };
  }, [editor]);
  return null;
}
