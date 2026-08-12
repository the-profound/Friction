import React from "react";
import { View, Text, ActivityIndicator, StyleSheet, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Colors } from "@/constants/tokens";
import { useGetThoughtQuestion, getGetThoughtQuestionQueryKey } from "@workspace/api-client-react";

interface ThoughtQuestionBannerProps {
  thoughtId: string;
  visible: boolean;
}

export default function ThoughtQuestionBanner({ thoughtId, visible }: ThoughtQuestionBannerProps) {
  const { data, isLoading } = useGetThoughtQuestion(thoughtId, {
    query: {
      enabled: visible && !!thoughtId,
      queryKey: getGetThoughtQuestionQueryKey(thoughtId),
    },
  });

  const question = data?.question ?? null;

  // While not loading and no question — render nothing
  if (!isLoading && !question) return null;

  return (
    <View style={styles.banner} pointerEvents="none">
      {isLoading ? (
        <ActivityIndicator size="small" color={Colors.zinc400} />
      ) : (
        <>
          <Feather name="edit-3" size={13} color={Colors.zinc400} style={styles.icon} />
          <Text style={styles.text} numberOfLines={2}>
            {question}
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    bottom: 10,
    left: 36,
    right: 36,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.zinc50,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    ...Platform.select({
      web: {
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
      } as object,
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
        elevation: 1,
      },
    }),
  },
  icon: {
    marginRight: 7,
    flexShrink: 0,
  },
  text: {
    flex: 1,
    fontSize: 13,
    color: Colors.zinc500,
    fontFamily: Platform.select({ ios: "Pretendard-Light", default: "Pretendard-Light" }),
    lineHeight: 19,
  },
});
