export function isQuestionThoughtMarkdown(content: string | null): boolean {
  const firstLine = (content ?? "").split(/\r?\n/, 1)[0]?.trim() ?? "";
  return /^#\s+Q\.\s+/i.test(firstLine) || /^Q\.\s+/i.test(firstLine);
}

export function formatPreliminaryQuestionMarkdown(title: string, description: string): string {
  return `# Q. ${title}\n\n${description}`;
}