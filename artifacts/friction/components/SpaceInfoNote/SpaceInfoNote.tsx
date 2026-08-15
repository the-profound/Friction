/**
 * SpaceInfoNote
 *
 * 공간 화면 전반에서 안내 문구를 표시하는 공용 컴포넌트.
 *
 * variants:
 *  - "inline"  : 회색 박스 안에 아이콘+텍스트 (infoBox / noSlotNotice 패턴 대체)
 *  - "bare"    : 배경 없이 아이콘+텍스트 한 줄 (noticeRow / roundsDisclaimerRow 패턴 대체)
 *  - "popup"   : ⓘ 아이콘만 노출, 탭하면 팝업 카드 표시 (새 기능)
 *
 * 플랫폼 호환:
 *  - Modal(popup) — 웹·iOS·Android 모두 지원
 *  - measureInWindow — 웹에서 getBoundingClientRect 폴백 사용
 *  - shadow — Platform.select(iOS shadow / Android elevation / web none)
 *  - borderWidth + overflow:hidden 혼용 없음 (friction-button-styles #2 준수)
 */

import React, { useCallback, useRef, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography } from "@/constants/tokens";

// ─── Constants ───────────────────────────────────────────────────────────────

const POPUP_MAX_WIDTH = 272;
const POPUP_MARGIN = 16; // minimum distance from screen edge
const POPUP_GAP_FROM_ICON = 6; // vertical gap between icon and popup

// ─── Types ───────────────────────────────────────────────────────────────────

export type SpaceInfoNoteVariant = "inline" | "bare" | "popup";

export interface SpaceInfoNoteProps {
  /** The guide text to display. */
  text: string;
  /**
   * Visual variant:
   *  - "inline" (default): always-visible gray box (infoBox / noSlotNotice style)
   *  - "bare": always-visible plain icon+text row without background
   *  - "popup": small ⓘ icon only; tap to reveal a floating popup card
   */
  variant?: SpaceInfoNoteVariant;
  /** Extra style applied to the outermost container (for spacing overrides). */
  style?: StyleProp<ViewStyle>;
  /** Accessibility label for the icon button (popup variant only). Default: "안내 보기" */
  accessibilityLabel?: string;
}

interface PopupPosition {
  top: number;
  left: number;
  width: number;
}

// ─── Main component ──────────────────────────────────────────────────────────

export function SpaceInfoNote({
  text,
  variant = "inline",
  style,
  accessibilityLabel,
}: SpaceInfoNoteProps) {
  if (variant === "inline") {
    return <InlineNote text={text} style={style} />;
  }
  if (variant === "bare") {
    return <BareNote text={text} style={style} />;
  }
  return (
    <PopupNote
      text={text}
      style={style}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

// ─── Inline variant ───────────────────────────────────────────────────────────
// Always-visible gray box: icon + text side by side.

function InlineNote({
  text,
  style,
}: {
  text: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.inlineContainer, style]}>
      <Feather name="info" size={13} color={Colors.zinc400} />
      <Text style={styles.inlineText}>{text}</Text>
    </View>
  );
}

// ─── Bare variant ─────────────────────────────────────────────────────────────
// Plain icon+text row, no background. For stacked notice lists.

function BareNote({
  text,
  style,
}: {
  text: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.bareContainer, style]}>
      <Feather name="info" size={13} color={Colors.zinc400} />
      <Text style={styles.bareText}>{text}</Text>
    </View>
  );
}

// ─── Popup variant ────────────────────────────────────────────────────────────
// Small ⓘ icon; tap opens a floating card. Tap outside (or ⓘ again) to close.

function PopupNote({
  text,
  style,
  accessibilityLabel,
}: {
  text: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [popupPos, setPopupPos] = useState<PopupPosition>({
    top: 0,
    left: 0,
    width: POPUP_MAX_WIDTH,
  });
  const iconRef = useRef<View>(null);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const handleIconPress = useCallback(() => {
    if (visible) {
      setVisible(false);
      return;
    }
    if (!iconRef.current) {
      setVisible(true);
      return;
    }

    iconRef.current.measureInWindow((x, y, iconW, iconH) => {
      const popupWidth = Math.min(POPUP_MAX_WIDTH, screenWidth - POPUP_MARGIN * 2);

      // Default: appear below the icon, left-aligned to it
      let top = y + iconH + POPUP_GAP_FROM_ICON;
      let left = x;

      // Clamp horizontally so the popup stays inside the screen
      if (left + popupWidth > screenWidth - POPUP_MARGIN) {
        left = screenWidth - POPUP_MARGIN - popupWidth;
      }
      if (left < POPUP_MARGIN) {
        left = POPUP_MARGIN;
      }

      // If popup would overflow the bottom, flip it above the icon instead.
      // We estimate height conservatively (3 lines × ~22px + 2×12 padding).
      const estimatedPopupHeight = 90;
      if (top + estimatedPopupHeight > screenHeight - POPUP_MARGIN) {
        top = y - estimatedPopupHeight - POPUP_GAP_FROM_ICON;
        // Guard against going above the screen
        if (top < POPUP_MARGIN) {
          top = POPUP_MARGIN;
        }
      }

      setPopupPos({ top, left, width: popupWidth });
      setVisible(true);
    });
  }, [visible, screenWidth, screenHeight]);

  const handleClose = useCallback(() => {
    setVisible(false);
  }, []);

  return (
    <>
      {/* Icon button — collapsable:false keeps the ref measurable on Android */}
      <View ref={iconRef} collapsable={false} style={[styles.popupIconWrapper, style]}>
        <Pressable
          onPress={handleIconPress}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? "안내 보기"}
          style={styles.popupIconPressable}
        >
          <Feather name="info" size={14} color={Colors.zinc400} />
        </Pressable>
      </View>

      {/* Popup card rendered inside a Modal so it floats above scroll containers */}
      <Modal
        visible={visible}
        transparent
        animationType="none"
        onRequestClose={handleClose}
        statusBarTranslucent
      >
        {/* Full-screen backdrop: tap anywhere to dismiss */}
        <Pressable style={styles.backdrop} onPress={handleClose}>
          {/* Popup card: inner Pressable absorbs touches so they don't reach backdrop */}
          <Pressable
            style={[
              styles.popup,
              popupStyles(popupPos),
            ]}
            // No onPress needed — just absorbs the tap to prevent backdrop close
          >
            <Text style={styles.popupText}>{text}</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// Dynamic style for the popup card position (created per-render, not in StyleSheet)
function popupStyles(pos: PopupPosition): ViewStyle {
  return {
    top: pos.top,
    left: pos.left,
    width: pos.width,
  };
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // inline variant
  inlineContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: Colors.zinc50,
    borderWidth: 1,
    borderColor: Colors.zinc100,
    // NOTE: no overflow:"hidden" — would conflict with borderWidth on iOS
    // (friction-button-styles rule #2)
  },
  inlineText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
    flex: 1,
    lineHeight: 19,
  },

  // bare variant
  bareContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  bareText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
    flex: 1,
    lineHeight: 17,
  },

  // popup variant — icon button
  popupIconWrapper: {
    // Wrapper kept separate so measureInWindow can find stable bounds
  },
  popupIconPressable: {
    // Extra padding makes the touch target large enough without affecting layout
    padding: 3,
  },

  // popup variant — Modal backdrop
  backdrop: {
    flex: 1,
  },

  // popup variant — card
  popup: {
    position: "absolute",
    backgroundColor: Colors.zinc50,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    padding: 12,
    // Platform-specific shadow (expo-web-compat rule)
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.10,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
      default: {}, // web — no shadow
    }),
  },
  popupText: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc600,
    lineHeight: 19,
  },
});
