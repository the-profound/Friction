import React, { useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography } from "@/constants/tokens";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import { useListStoredSentences, getListStoredSentencesQueryKey } from "@workspace/api-client-react";
import type { StoredSentence } from "@workspace/api-client-react";

interface QuoteSentencePickerBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  userId: string;
  onSelect: (sentence: StoredSentence) => void;
}

export default function QuoteSentencePickerBottomSheet({
  visible,
  onClose,
  userId,
  onSelect,
}: QuoteSentencePickerBottomSheetProps) {
  const sentencesQuery = useListStoredSentences(
    { userId },
    {
      query: {
        queryKey: getListStoredSentencesQueryKey({ userId }),
        enabled: visible && !!userId,
      },
    },
  );

  const sentences = (sentencesQuery.data ?? []) as StoredSentence[];

  const handlePress = useCallback(
    (sentence: StoredSentence) => {
      onSelect(sentence);
    },
    [onSelect],
  );

  return (
    <BottomSheet visible={visible} onClose={onClose} title="문장 인용" snapPoints={[0.6]} closeButton>
      {sentencesQuery.isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color={Colors.zinc400} />
        </View>
      ) : sentences.length === 0 ? (
        <View style={styles.centerContainer}>
          <Feather name="bookmark" size={32} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>수집한 문장이 없어요</Text>
          <Text style={styles.emptySubtitle}>읽으면서 마음에 드는 문장을 수집해보세요</Text>
        </View>
      ) : (
        <ScrollView
          nestedScrollEnabled
          style={styles.scrollView}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        >
          {sentences.map((item) => (
            <ScalePressable
              key={item.id}
              style={styles.item}
              contentStyle={styles.itemContent}
              onPress={() => handlePress(item)}
            >
              <Text style={styles.itemText} numberOfLines={3}>
                {item.text}
              </Text>
              {item.articleTitle ? (
                <Text style={styles.itemSource} numberOfLines={1}>
                  {item.articleTitle}
                </Text>
              ) : null}
            </ScalePressable>
          ))}
        </ScrollView>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  list: {
    paddingBottom: 16,
  },
  item: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  itemContent: {
    alignItems: "flex-start",
    gap: 4,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  itemText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc900,
    lineHeight: 21,
  },
  itemSource: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    paddingVertical: 40,
  },
  emptyTitle: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc900,
    marginTop: 8,
  },
  emptySubtitle: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
    textAlign: "center",
  },
});
