import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $generateNodesFromMarkdownString,
  type Transformer,
} from '@lexical/markdown';
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  PASTE_COMMAND,
} from 'lexical';
import { useEffect } from 'react';

// Deliberately conservative: prose shouldn't be reinterpreted just because it
// contains an asterisk. Single-asterisk italics and single-tilde strikethrough
// are left out as triggers for that reason — they still convert once one of
// these has established that the text really is Markdown.
const MARKDOWN_MARKERS = [
  /^ {0,3}[-*+] /m,
  /^ {0,3}\d+\. /m,
  /^ {0,3}> /m,
  /^ {0,3}```/m,
  /\*\*[^*\n]+\*\*/,
  /\[[^\]\n]+\]\([^)\s]+\)/,
];

const looksLikeMarkdown = (text: string) =>
  MARKDOWN_MARKERS.some((marker) => marker.test(text));

// Interprets pasted plain text as Markdown, inserting the parsed nodes at the
// selection rather than replacing the document. Runs above the default rich
// text paste (COMMAND_PRIORITY_EDITOR) so it gets first refusal on plain text,
// and below PasteLinkPlugin (COMMAND_PRIORITY_HIGH) so pasting a bare URL onto
// selected text still links that text instead.
//
// Headings are not in `transformers` — by design, since they aren't in the
// node set — so a pasted `# Title` stays literal, exactly as typing it does.
export function MarkdownPastePlugin({
  transformers,
}: {
  transformers: Transformer[];
}): null {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          if (!(event instanceof ClipboardEvent) || !event.clipboardData) {
            return false;
          }
          // Anything carrying text/html is already richer than Markdown, and
          // Lexical's own HTML import handles it better than re-reading the
          // plain-text fallback would. The cost is that editors which copy
          // syntax-highlighted HTML (VS Code) paste as styled text, not Markdown.
          if (event.clipboardData.types.includes('text/html')) {
            return false;
          }
          const text = event.clipboardData.getData('text/plain');
          if (!text || !looksLikeMarkdown(text)) {
            return false;
          }
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) {
            return false;
          }
          event.preventDefault();
          selection.insertNodes(
            $generateNodesFromMarkdownString(text, transformers),
          );
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor, transformers],
  );
  return null;
}
