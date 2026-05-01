type FontListener = (regular: string, semiBold: string) => void;

let regularBase64: string | null = null;
let semiBoldBase64: string | null = null;
const listeners: FontListener[] = [];

export function setEditorFonts(regular: string, semiBold: string): void {
  regularBase64 = regular;
  semiBoldBase64 = semiBold;
  for (const listener of listeners) {
    listener(regular, semiBold);
  }
}

export function getEditorFonts(): { regularBase64: string | null; semiBoldBase64: string | null } {
  return { regularBase64, semiBoldBase64 };
}

export function subscribeEditorFonts(listener: FontListener): () => void {
  listeners.push(listener);
  return () => {
    const index = listeners.indexOf(listener);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  };
}
