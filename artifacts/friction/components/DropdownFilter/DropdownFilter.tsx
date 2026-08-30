import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Platform,
  useWindowDimensions,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import ScalePressable from "@/components/shared/ScalePressable";
import PillButton, { type PillVariant } from "@/components/shared/PillButton";
import { Colors, Typography, ZIndex } from "@/constants/tokens";
import {
  getDropdownFilterLabel,
  isDropdownFilterActive,
} from "./dropdownFilterUtils";

export { getDropdownFilterLabel, isDropdownFilterActive } from "./dropdownFilterUtils";

export interface DropdownOption<T extends string> {
  key: T;
  label: string;
}

interface Anchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_DROPDOWN_WIDTH = 140;
const DROPDOWN_GAP = 6;
const DROPDOWN_MARGIN = 12;
const DROPDOWN_ROW_HEIGHT = 44;

export interface DropdownFilterProps<T extends string> {
  label: string;
  value: T;
  /** The value that represents the filter's unfiltered/default state. */
  defaultValue: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  /** Replaces the option label in the capsule when an active value is selected. */
  selectedLabel?: string;
  /** Shows the selected option label even when value equals defaultValue. */
  showDefaultOptionLabel?: boolean;
  /** Visual variant used when a non-default option is selected. */
  activeVariant?: Extract<PillVariant, "primary" | "outline">;
  /** Width of the options menu before it is clamped to the viewport. */
  dropdownWidth?: number;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export default function DropdownFilter<T extends string>({
  label,
  value,
  defaultValue,
  options,
  onChange,
  selectedLabel,
  showDefaultOptionLabel = false,
  activeVariant = "primary",
  dropdownWidth = DEFAULT_DROPDOWN_WIDTH,
  accessibilityLabel,
  accessibilityHint,
}: DropdownFilterProps<T>) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const pillRef = useRef<View>(null);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const isFiltered = isDropdownFilterActive(value, defaultValue);
  const selectedOption = options.find((o) => o.key === value);
  const buttonLabel = getDropdownFilterLabel({
    label,
    value,
    defaultValue,
    selectedLabel,
    selectedOptionLabel: selectedOption?.label,
    showDefaultOptionLabel,
  });
  const pillVariant: Extract<PillVariant, "primary" | "outline"> =
    isFiltered ? activeVariant : "outline";

  const handleClose = useCallback(() => setOpen(false), []);

  const handleOpen = useCallback(() => {
    if (open) {
      handleClose();
      return;
    }

    const pill = pillRef.current;
    if (!pill) {
      setOpen(true);
      return;
    }

    // collapsable={false} keeps this measurement available on Android.
    pill.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      setOpen(true);
    });
  }, [handleClose, open]);

  const handleSelect = useCallback((key: T) => {
    onChange(key);
    handleClose();
  }, [handleClose, onChange]);

  // Modal's onRequestClose handles Android's hardware back button. React
  // Native Web does not consistently forward Escape to that callback, so
  // explicitly provide the equivalent keyboard dismissal there.
  useEffect(() => {
    if (!open || Platform.OS !== "web") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleClose, open]);

  const menuWidth = Math.max(
    1,
    Math.min(
      dropdownWidth,
      screenWidth > DROPDOWN_MARGIN * 2
        ? screenWidth - DROPDOWN_MARGIN * 2
        : dropdownWidth,
    ),
  );
  const menuHeight =
    options.length * DROPDOWN_ROW_HEIGHT +
    Math.max(0, options.length - 1) * StyleSheet.hairlineWidth;
  const dropdownTop = anchor
    ? getDropdownTop(anchor, menuHeight, screenHeight)
    : 0;
  const dropdownLeft = anchor
    ? getDropdownLeft(anchor, menuWidth, screenWidth)
    : 0;


  return (
    <View
      ref={pillRef}
      collapsable={false}
      style={styles.wrapper}
    >
      <PillButton
        size="sm"
        variant={pillVariant}
        contentStyle={styles.pillContent}
        onPress={handleOpen}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint ?? `${label} 필터 옵션 열기`}
        accessibilityState={{ expanded: open, selected: isFiltered }}
      >
        <Text
          style={[styles.pillText, pillVariant === "primary" && styles.pillTextActive]}
          numberOfLines={1}
        >
          {buttonLabel}
        </Text>
        <Feather
          name="chevron-down"
          size={13}
          color={pillVariant === "primary" ? Colors.white : Colors.zinc500}
        />
      </PillButton>

      <Modal
        visible={open}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={handleClose}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="필터 메뉴 닫기"
        />
        <View
          style={[
            styles.dropdownShadow,
            { top: dropdownTop, left: dropdownLeft, width: menuWidth },
          ]}
          pointerEvents="box-none"
        >
          <View
            style={styles.dropdownClip}
            accessibilityRole="menu"
            accessibilityLabel={`${label} 옵션`}
          >
            {options.map((option, index) => {
              const active = option.key === value;
              const isLast = index === options.length - 1;
              return (
                <React.Fragment key={option.key}>
                  <ScalePressable
                    style={styles.row}
                    contentStyle={styles.rowContent}
                    onPress={() => handleSelect(option.key)}
                    accessibilityRole="menuitem"
                    accessibilityLabel={option.label}
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      style={[styles.rowLabel, active && styles.rowLabelActive]}
                      numberOfLines={1}
                    >
                      {option.label}
                    </Text>
                    {active && (
                      <Feather name="check" size={14} color={Colors.zinc900} />
                    )}
                  </ScalePressable>
                  {!isLast && <View style={styles.divider} />}
                </React.Fragment>
              );
            })}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function getDropdownLeft(
  anchor: Anchor,
  menuWidth: number,
  screenWidth: number,
): number {
  const maxLeft = Math.max(DROPDOWN_MARGIN, screenWidth - menuWidth - DROPDOWN_MARGIN);
  return Math.max(DROPDOWN_MARGIN, Math.min(anchor.x, maxLeft));
}

function getDropdownTop(
  anchor: Anchor,
  menuHeight: number,
  screenHeight: number,
): number {
  const below = anchor.y + anchor.height + DROPDOWN_GAP;
  const above = anchor.y - menuHeight - DROPDOWN_GAP;
  const bottomLimit = Math.max(DROPDOWN_MARGIN, screenHeight - menuHeight - DROPDOWN_MARGIN);

  if (below <= bottomLimit) return below;
  if (above >= DROPDOWN_MARGIN) return above;
  return Math.min(Math.max(DROPDOWN_MARGIN, below), bottomLimit);
}

const styles = StyleSheet.create({
  wrapper: {
    alignSelf: "flex-start",
    height: 33,
    flexGrow: 0,
    flexShrink: 0,
  },
  pillContent: {
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: "auto",
    height: 33,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  pillText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc600,
    fontFamily: Platform.select({
      ios: "Pretendard-Regular",
      default: "Pretendard-Regular",
    }),
  },
  pillTextActive: {
    color: Colors.white,
    fontFamily: Platform.select({
      ios: "Pretendard-SemiBold",
      default: "Pretendard-SemiBold",
    }),
    fontWeight: "600",
  },
  dropdownShadow: {
    position: "absolute",
    borderRadius: 14,
    backgroundColor: Colors.white,
    zIndex: ZIndex.modal,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.16,
        shadowRadius: 12,
      },
      android: {
        elevation: 10,
      },
      default: {},
    }),
  },
  dropdownClip: {
    width: "100%",
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: Colors.white,
  },
  row: {
    height: DROPDOWN_ROW_HEIGHT,
    flexGrow: 0,
    flexShrink: 0,
  },
  rowContent: {
    height: DROPDOWN_ROW_HEIGHT,
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  rowLabel: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc600,
    fontFamily: Platform.select({
      ios: "Pretendard-Regular",
      default: "Pretendard-Regular",
    }),
  },
  rowLabelActive: {
    color: Colors.zinc900,
    fontFamily: Platform.select({
      ios: "Pretendard-SemiBold",
      default: "Pretendard-SemiBold",
    }),
    fontWeight: "600",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.zinc200,
    marginHorizontal: 12,
  },
});
