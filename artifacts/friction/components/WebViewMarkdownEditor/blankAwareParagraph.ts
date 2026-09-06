import { Paragraph } from "@tiptap/extension-paragraph";

import {
  CARET_PARAGRAPH_ATTRIBUTE,
  PRESERVED_BLANK_PARAGRAPH_ATTRIBUTE,
} from "../../lib/markdownBlankLines";

export const BlankAwareParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      preservedBlank: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute(PRESERVED_BLANK_PARAGRAPH_ATTRIBUTE),
        renderHTML: (attributes) =>
          attributes.preservedBlank === "true"
            ? { [PRESERVED_BLANK_PARAGRAPH_ATTRIBUTE]: "true" }
            : {},
      },
      caretParagraph: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute(CARET_PARAGRAPH_ATTRIBUTE),
        renderHTML: (attributes) =>
          attributes.caretParagraph === "true"
            ? { [CARET_PARAGRAPH_ATTRIBUTE]: "true" }
            : {},
      },
    };
  },
});