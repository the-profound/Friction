export function normalizePageItem(item: unknown): string {
  if (typeof item === 'string') return item;
  if (item !== null && typeof item === 'object' && typeof (item as { content?: unknown }).content === 'string') {
    return (item as { content: string }).content;
  }
  return '';
}
