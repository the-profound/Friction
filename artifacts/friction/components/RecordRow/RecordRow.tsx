import React, { useState } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import ScalePressable from "@/components/shared/ScalePressable";
import { Colors, ReaderTokens, Shadows, Spacing, Typography, readerFontSize } from "@/constants/tokens";
import { getRecordPreview, type UnifiedRecord } from "@/lib/recordList";

const NON_SELECTABLE_WEB_STYLE =
  Platform.OS === "web" ? ({ userSelect: "none" } as object) : undefined;

function RecordListText({
  style,
  ...props
}: React.ComponentProps<typeof Text>) {
  return (
    <Text
      {...props}
      selectable={false}
      style={[NON_SELECTABLE_WEB_STYLE, style]}
    />
  );
}

function relativeDate(value: string): string {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}일 전`;
  const date = new Date(value);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export interface RecordRowProps {
  record: UnifiedRecord;
  isQuestion?: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onSend?: () => void;
  onArchive?: () => void;
}

export default function RecordRow({
  record,
  isQuestion = false,
  onPress,
  onLongPress,
  onSend,
  onArchive,
}: RecordRowProps) {
  const { width: windowWidth } = useWindowDimensions();
  const [textFrameWidth, setTextFrameWidth] = useState(0);
  const preview = getRecordPreview(record);
  const title = preview.titleDisplay || preview.body || "제목 없음";
  const showsTitle = preview.hasTitle || record.kind !== "thought";
  const bodyLines = preview.hasTitle || record.kind !== "thought" ? 3 : 5;
  const fallbackTextWidth = Math.max(1, windowWidth - Spacing.screenPx * 2);
  const contentWidth = textFrameWidth || fallbackTextWidth;
  const titleSize = readerFontSize(ReaderTokens.typeScale.titleCqi, contentWidth);
  const bodySize = readerFontSize(ReaderTokens.typeScale.bodyCqi, contentWidth);

  return (
    <ScalePressable
      style={styles.row}
      contentStyle={[styles.rowContent, isQuestion && styles.questionRowContent, NON_SELECTABLE_WEB_STYLE]}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityLabel={isQuestion ? "대기 중인 질문 열기" : `${record.kind === "thought" ? "단상" : record.kind === "editing" ? "편집 글" : "편지"} 열기`}
      accessibilityHint={isQuestion ? "누르면 이 질문에 답하는 단상을 시작합니다." : "길게 눌러 삭제"}
    >
      <View
        style={styles.rowTextFrame}
        onLayout={(event) => {
          const nextWidth = Math.round(event.nativeEvent.layout.width);
          if (nextWidth !== textFrameWidth) setTextFrameWidth(nextWidth);
        }}
      >
        {!isQuestion ? (
          <View style={[styles.rowMeta, record.kind === "thought" && styles.rowMetaThought]}>
            {record.kind !== "thought" ? (
              <RecordListText style={styles.rowKind}>{record.kind === "editing" ? "편집" : "편지"}</RecordListText>
            ) : null}
            <RecordListText style={styles.rowDate}>{relativeDate(record.updatedAt)}</RecordListText>
          </View>
        ) : null}
        {showsTitle ? (
          <RecordListText
            style={[styles.rowTitle, isQuestion && styles.questionRowText, { fontSize: titleSize, lineHeight: titleSize * 1.28 }]}
          >
            {title}
          </RecordListText>
        ) : null}
        <RecordListText
          style={[styles.rowBody, isQuestion && styles.questionRowText, { fontSize: bodySize, lineHeight: bodySize * 1.7 }]}
          numberOfLines={bodyLines}
        >
          {preview.body || "아직 적힌 내용이 없어요."}
        </RecordListText>
      </View>
      {record.kind === "letter" && (onSend || onArchive) ? (
        <View style={styles.rowLetterActions}>
          {onSend ? (
            <ScalePressable style={styles.rowLetterAction} contentStyle={styles.rowLetterActionContent} onPress={(event) => { event.stopPropagation(); onSend(); }}>
              <Feather name="send" size={14} color={Colors.zinc600} />
              <RecordListText style={styles.rowLetterActionText}>보내기</RecordListText>
            </ScalePressable>
          ) : null}
          {onArchive ? (
            <ScalePressable style={styles.rowLetterAction} contentStyle={styles.rowLetterActionContent} onPress={(event) => { event.stopPropagation(); onArchive(); }}>
              <Feather name="folder" size={14} color={Colors.zinc600} />
              <RecordListText style={styles.rowLetterActionText}>보관</RecordListText>
            </ScalePressable>
          ) : null}
        </View>
      ) : null}
    </ScalePressable>
  );
}

const styles = StyleSheet.create({
  row: { marginHorizontal: Spacing.screenPx, marginBottom: Spacing.cardGap },
  rowContent: { padding: 16, gap: 7, borderRadius: 16, backgroundColor: Colors.white, ...Shadows.card },
  questionRowContent: { backgroundColor: Colors.noticeAccent },
  rowMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowMetaThought: { justifyContent: "flex-end" },
  rowKind: { ...Typography.caption, color: Colors.zinc500, fontWeight: "600" },
  rowDate: { ...Typography.caption, color: Colors.zinc500 },
  rowTextFrame: { width: "100%" },
  rowTitle: { fontFamily: ReaderTokens.fontFamily.serifBold, color: Colors.zinc900 },
  rowBody: { fontFamily: ReaderTokens.fontFamily.serif, color: Colors.zinc600 },
  questionRowText: { color: Colors.white },
  rowLetterActions: { flexDirection: "row", gap: 6, marginTop: 2 },
  rowLetterAction: { height: 32, flexGrow: 0, flexShrink: 0 },
  rowLetterActionContent: { height: 32, flexGrow: 0, flexShrink: 0, paddingHorizontal: 10, borderRadius: 16, backgroundColor: Colors.zinc100, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  rowLetterActionText: { ...Typography.caption, color: Colors.zinc600, fontWeight: "600" },
});
