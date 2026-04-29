let regularBase64: string | null = null;
let semiBoldBase64: string | null = null;

export function setEditorFonts(regular: string, semiBold: string): void {
  regularBase64 = regular;
  semiBoldBase64 = semiBold;
}

export function getEditorFonts(): { regularBase64: string | null; semiBoldBase64: string | null } {
  return { regularBase64, semiBoldBase64 };
}
