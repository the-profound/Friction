import React, { useRef, useImperativeHandle, forwardRef } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  Text,
  Platform,
} from "react-native";
import Animated, { useAnimatedStyle, SharedValue } from "react-native-reanimated";
import { Colors } from "@/constants/tokens";

export interface MemoPageViewRef {
  focus: () => void;
  blur: () => void;
}

interface MemoPageViewProps {
  content: string;
  pageIndex: number;
  totalPages: number;
  onChange: (text: string) => void;
  onOverflow?: () => void;
  containerWidth: number;
  containerHeight: number;
  paddingX: number;
  paddingY: number;
  bodyFontSize: number;
  bodyLineHeight: number;
  onFocus?: () => void;
  onBlur?: () => void;
  keyboardVisible?: boolean;
  bottomInset?: number;
  flipAngle?: SharedValue<number>;
}

const MEMO_BG = "#FFFAEB";

const MemoPageView = forwardRef<MemoPageViewRef, MemoPageViewProps>(
  function MemoPageView(
    {
      content,
      pageIndex,
      totalPages,
      onChange,
      onOverflow,
      containerWidth,
      containerHeight,
      paddingX,
      paddingY,
      bodyFontSize,
      bodyLineHeight,
      onFocus,
      onBlur,
      keyboardVisible,
      bottomInset = 0,
      flipAngle,
    },
    ref,
  ) {
    const inputRef = useRef<TextInput>(null);

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
      blur: () => inputRef.current?.blur(),
    }));

    const hintRowH = bodyFontSize * 0.78 + paddingY * 0.6;
    const textAreaHeight =
      containerHeight - hintRowH - paddingY * 2 - bottomInset - 20;

    const handleContentSizeChange = (e: {
      nativeEvent: { contentSize: { height: number } };
    }) => {
      if (e.nativeEvent.contentSize.height > textAreaHeight && onOverflow) {
        onOverflow();
      }
    };

    // 3D top-pivot flip transform: rotate around the top edge of the card
    // translateY(-H/2) moves the pivot to the top edge before rotating,
    // then translateY(+H/2) restores position after rotation.
    const animStyle = useAnimatedStyle(() => {
      const angle = flipAngle ? flipAngle.value : 0;
      if (angle === 0) return {};
      const H = containerHeight;
      return {
        transform: [
          { perspective: 1000 },
          { translateY: -H / 2 },
          { rotateX: `${angle}deg` },
          { translateY: H / 2 },
        ],
      };
    });

    return (
      <Animated.View
        style={[
          styles.card,
          { width: containerWidth, height: containerHeight, backgroundColor: MEMO_BG },
          animStyle,
        ]}
      >
        {/* Page hint */}
        <View
          style={[
            styles.hintRow,
            {
              paddingHorizontal: paddingX,
              paddingTop: paddingY * 0.6,
              height: hintRowH,
            },
          ]}
        >
          <Text style={[styles.hintText, { fontSize: bodyFontSize * 0.78 }]}>
            {pageIndex + 1} / {totalPages}
          </Text>
          {!keyboardVisible && (
            <Text style={[styles.swipeHint, { fontSize: bodyFontSize * 0.72 }]}>
              ↑↓ 스와이프로 이동
            </Text>
          )}
        </View>

        {/* Text input */}
        <TextInput
          ref={inputRef}
          style={[
            styles.input,
            {
              paddingHorizontal: paddingX,
              paddingTop: paddingY * 0.5,
              paddingBottom: paddingY,
              fontSize: bodyFontSize,
              lineHeight: bodyLineHeight,
              height: textAreaHeight,
              fontFamily: Platform.select({
                ios: "Eulyoo1945-Regular",
                default: "Eulyoo1945-Regular",
              }),
            },
          ]}
          value={content}
          onChangeText={onChange}
          multiline
          scrollEnabled={false}
          textAlignVertical="top"
          placeholder="이 페이지에 메모를 적어보세요..."
          placeholderTextColor={Colors.zinc300}
          onContentSizeChange={handleContentSizeChange}
          onFocus={onFocus}
          onBlur={onBlur}
          autoCorrect={false}
          autoCapitalize="none"
          keyboardType="default"
          returnKeyType="default"
        />
      </Animated.View>
    );
  },
);

export default MemoPageView;

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
    borderRadius: 2,
  },
  hintRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  hintText: {
    color: Colors.zinc400,
    fontFamily: Platform.select({
      ios: "Pretendard-Regular",
      default: "Pretendard",
    }),
  },
  swipeHint: {
    color: Colors.zinc300,
    fontFamily: Platform.select({
      ios: "Pretendard-Regular",
      default: "Pretendard",
    }),
  },
  input: {
    color: Colors.zinc800,
    padding: 0,
    margin: 0,
    backgroundColor: "transparent",
    includeFontPadding: false,
  },
});
