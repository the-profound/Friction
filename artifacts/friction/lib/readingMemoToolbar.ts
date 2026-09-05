export type EditorKeyboardState = {
  editorFocused: boolean;
  nativeKeyboardVisible: boolean;
};

export type EditorKeyboardEvent =
  | { type: "editorFocus"; focused: boolean }
  | { type: "nativeKeyboard"; visible: boolean };

export const INITIAL_EDITOR_KEYBOARD_STATE: EditorKeyboardState = {
  editorFocused: false,
  nativeKeyboardVisible: false,
};

export function dismissEditorKeyboard(actions: {
  blurEditor: () => void;
  dismissNativeKeyboard: () => void;
}): void {
  actions.blurEditor();
  actions.dismissNativeKeyboard();
}

/**
 * Native keyboard events own the closed state. WebView focus may arrive before
 * keyboardWillShow/keyboardDidShow, and transient focusout events may arrive
 * while the native keyboard is still on screen.
 */
export function reduceEditorKeyboardState(
  state: EditorKeyboardState,
  event: EditorKeyboardEvent,
): EditorKeyboardState {
  if (event.type === "nativeKeyboard") {
    return {
      ...state,
      nativeKeyboardVisible: event.visible,
      ...(!event.visible ? { editorFocused: false } : {}),
    };
  }
  return { ...state, editorFocused: event.focused };
}

export type MemoToolbarRenderContract = {
  visible: boolean;
  mode: "full" | "restricted";
  placement: "keyboardAvoidingFlow" | "floating";
};

export type MemoEditorContext = "readingMemo" | "record";

export function resolveMemoToolbarRenderContract(input: {
  platform: string;
  isNavigating: boolean;
  editorContext?: MemoEditorContext;
  selectionIsHorizontalRule: boolean;
  keyboard: EditorKeyboardState;
  inlineMenuOpen: boolean;
  keyboardRestorePending: boolean;
}): MemoToolbarRenderContract {
  const {
    platform,
    isNavigating,
    editorContext,
    selectionIsHorizontalRule,
    keyboard,
    inlineMenuOpen,
    keyboardRestorePending,
  } = input;
  const nativeScreenAvailable = platform !== "web" && !isNavigating;

  if (editorContext === "readingMemo") {
    return {
      visible:
        nativeScreenAvailable &&
        (keyboard.nativeKeyboardVisible || keyboard.editorFocused),
      mode: "restricted",
      placement: "keyboardAvoidingFlow",
    };
  }

  return {
    visible:
      nativeScreenAvailable &&
      !selectionIsHorizontalRule &&
      (keyboard.nativeKeyboardVisible || inlineMenuOpen || keyboardRestorePending),
    mode: "full",
    placement: "floating",
  };
}