import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  Pressable,
  useWindowDimensions,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors } from "@/constants/tokens";

const POPUP_W = 140;
// MemoToolbar 캡슐 높이(paddingVertical 8×2 + 캡슐 44) — 팝업을 툴바 바로 위에 띄운다.
const TOOLBAR_H = 60;

interface AddMenuPopupProps {
  /** 현재 키보드 높이. 팝업은 키보드 + 툴바 위에 floating 한다. */
  keyboardHeight: number;
  /** 툴바 [+] 버튼 중심의 화면 X 좌표. null이면 화면 중앙 기준. */
  plusBtnCenterX: number | null;
  onDismiss: () => void;
  /** "수집한 문장" 선택 시 호출 (quotePicker 패널 열기 등). */
  onSelectQuote: () => void;
}

/**
 * 서식 툴바 [+] 버튼에서 뜨는 floating 팝업 메뉴.
 * 읽기 메모(read.tsx)와 기록 작성(on-01a.tsx) 양쪽에서 공유한다.
 */
export default function AddMenuPopup({
  keyboardHeight,
  plusBtnCenterX,
  onDismiss,
  onSelectQuote,
}: AddMenuPopupProps) {
  const { width: screenWidth } = useWindowDimensions();
  const cx = plusBtnCenterX ?? screenWidth / 2;
  const left = Math.max(16, Math.min(screenWidth - 16 - POPUP_W, cx - POPUP_W / 2));

  return (
    <>
      {/* 투명 오버레이 — 탭하면 팝업 닫힘 */}
      <Pressable
        style={[StyleSheet.absoluteFill, { zIndex: 52 }]}
        onPress={onDismiss}
      />
      {/* 팝업 카드 — 툴바 위 [+] 버튼 위치에 floating */}
      <View
        style={[
          styles.popup,
          { bottom: keyboardHeight + TOOLBAR_H + 4, left },
        ]}
      >
        <View style={styles.inner}>
          <Pressable style={styles.row} onPress={onSelectQuote}>
            <MaterialCommunityIcons
              name="text-box-outline"
              size={16}
              color="#3f3f46"
              style={styles.icon}
            />
            <Text style={styles.label}>수집한 문장</Text>
          </Pressable>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  popup: {
    position: "absolute",
    width: POPUP_W,
    borderRadius: 12,
    zIndex: 54,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.14,
        shadowRadius: 10,
      },
      android: { elevation: 10 },
    }),
  },
  inner: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  icon: {
    marginRight: 10,
  },
  label: {
    fontSize: 15,
    color: Colors.zinc800,
    fontFamily: Platform.select({ ios: "Pretendard-Regular", default: "Pretendard" }),
  },
});
