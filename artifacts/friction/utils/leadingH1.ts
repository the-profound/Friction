import {
  splitLeadingThoughtH1,
  type ThoughtDocumentParts,
} from "@workspace/api-zod";

export interface LeadingH1Markdown {
  titleMarkdown: string;
  body: string;
}

/**
 * Splits the leading ATX H1 from its body while preserving authored hard
 * breaks inside that H1. A continuation belongs to the title only when the
 * preceding title line ends with Markdown's two-space hard-break marker.
 */
export function splitLeadingH1Markdown(markdown: string): LeadingH1Markdown | null {
  const parts: ThoughtDocumentParts | null = splitLeadingThoughtH1(markdown);
  if (!parts) return null;
  return {
    titleMarkdown: parts.titleMarkdown,
    body: parts.bodyMarkdown,
  };
}