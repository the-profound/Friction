import React, { useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import ScalePressable from "@/components/shared/ScalePressable";
import PillButton from "@/components/shared/PillButton";
import { Colors, Typography, ZIndex } from "@/constants/tokens";

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

const DROPDOWN_WIDTH = 140;
const DROPDOWN_GAP = 6;

interface DropdownFilterProps<T extends string> {
  label: string;
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
}

export default function DropdownFilter<T extends string>({
  label,
  value,
  options,
  onChange,
}: DropdownFilterProps<T>) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const pillRef = useRef<View>(null);

  const isFiltered = value !== ("all" as T);
  const selectedOption = options.find((o) => o.key === value);
  const buttonLabel = isFiltered && selectedOption ? selectedOption.label : label;

  const handleOpen = () => {
    pillRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      setOpen(true);
    });
  };

  const handleSelect = (key: T) => {
    onChange(key);
    setOpen(false);
  };

  const dropdownTop = anchor ? anchor.y + anchor.height + DROPDOWN_GAP : 0;
  const dropdownLeft = anchor ? anchor.x : 0;

  return (
    <View ref={pillRef} collapsable={false}>
      <PillButton
        size="sm"
        variant={isFiltered ? "primary" : "outline"}
        contentStyle={styles.pillContent}
        onPress={handleOpen}
      >
        <Text
          style={[styles.pillText, isFiltered && styles.pillTextActive]}
          numberOfLines={1}
        >
          {buttonLabel}
        </Text>
        <Feather
          name="chevron-down"
          size={13}
          color={isFiltered ? Colors.white : Colors.zinc500}
        />
      </PillButton>

      <Modal
        visible={open}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
        <View
          style={[
            styles.dropdownShadow,
            { top: dropdownTop, left: dropdownLeft },
          ]}
          pointerEvents="box-none"
        >
          <View style={styles.dropdownClip}>
            {options.map((option, index) => {
              const active = option.key === value;
              const isLast = index === options.length - 1;
              return (
                <React.Fragment key={option.key}>
                  <ScalePressable
                    style={styles.row}
                    contentStyle={styles.rowContent}
                    onPress={() => handleSelect(option.key)}
                  >
                    <Text style={[styles.rowLabel, active && styles.rowLabelActive]}>
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

const styles = StyleSheet.create({
  pillContent: {
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: "auto",
    height: "100%",
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
    width: DROPDOWN_WIDTH,
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
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: Colors.white,
  },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  rowContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
