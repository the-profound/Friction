export interface EditorFontState {
  regularBase64: string | null;
  semiBoldBase64: string | null;
  error: string | null;
}

type FontListener = (state: EditorFontState) => void;

let state: EditorFontState = {
  regularBase64: null,
  semiBoldBase64: null,
  error: null,
};
const listeners: FontListener[] = [];

function emit(): void {
  for (const listener of listeners) {
    listener(state);
  }
}

export function setEditorFonts(regular: string, semiBold: string): void {
  state = { regularBase64: regular, semiBoldBase64: semiBold, error: null };
  emit();
}

export function setEditorFontsError(message: string): void {
  state = { ...state, error: message };
  emit();
}

let errorToastShown = false;

export function consumeEditorFontsErrorToast(): boolean {
  if (errorToastShown) return false;
  errorToastShown = true;
  return true;
}

export function getEditorFonts(): EditorFontState {
  return state;
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
