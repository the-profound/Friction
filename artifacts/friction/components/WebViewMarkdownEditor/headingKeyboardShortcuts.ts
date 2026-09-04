import { Heading } from "@tiptap/extension-heading";

interface HeadingEditorLike {
  state: {
    selection: {
      empty: boolean;
      $from: {
        parentOffset: number;
        parent: {
          type: {
            name: string;
          };
        };
      };
    };
  };
  commands: {
    setParagraph: () => boolean;
  };
}

/**
 * Convert a heading to a paragraph when deletion is requested at the very
 * beginning of the block. The content is intentionally left untouched.
 *
 * The backward-delete key is reported as Backspace by the web and native
 * WebView editors. Forward deletion (Delete) remains TipTap's native command.
 */
export function shouldConvertHeadingToParagraph(
  editor: Pick<HeadingEditorLike, "state">,
): boolean {
  const { selection } = editor.state;
  const { $from, empty } = selection;
  return (
    empty && $from.parentOffset === 0 && $from.parent.type.name === "heading"
  );
}

function convertHeadingToParagraph(editor: HeadingEditorLike): boolean {
  if (!shouldConvertHeadingToParagraph(editor)) return false;
  return editor.commands.setParagraph();
}

export function createHeadingKeyboardShortcuts() {
  return {
    Backspace: ({ editor }: { editor: HeadingEditorLike }) =>
      convertHeadingToParagraph(editor),
  };
}

export function createHeadingWithParagraphShortcut() {
  return Heading.extend({
    addKeyboardShortcuts: createHeadingKeyboardShortcuts,
  });
}
