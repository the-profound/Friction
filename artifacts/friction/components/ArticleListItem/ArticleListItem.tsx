import React from "react";
import { Feather } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";
import type { ArticleCover } from "@workspace/api-client-react";
import ScalePressable from "@/components/shared/ScalePressable";
import ArticleCardCover from "@/components/ArticleCardItem/ArticleCardCover";
import { Colors, Shadows, Spacing } from "@/constants/tokens";

export const ARTICLE_LIST_ITEM_HEIGHT = 104;

/**
 * The shared compact letter row.
 *
 * A list row deliberately has a smaller contract than a record row: the cover
 * is the surface, and only the letter title and author are placed on it.
 * Callers keep ownership of navigation and long-press actions; no detail query
 * is needed to render this component.
 */
export interface ArticleListItemProps {
  articleId: string;
  title: string;
  authorName?: string | null;
  cover?: ArticleCover | null;
  onPress: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  selected?: boolean;
  accessibilityLabel?: string;
}

function getAccessibilityLabel(
  title: string,
  authorName: string | null | undefined,
): string {
  const displayTitle = title.trim() || "제목 없음";
  const displayAuthor = authorName?.trim();
  return displayAuthor
    ? `${displayTitle}, ${displayAuthor}의 편지`
    : `${displayTitle} 편지`;
}

function ArticleListItem({
  articleId,
  title,
  authorName,
  cover,
  onPress,
  onLongPress,
  disabled = false,
  selected = false,
  accessibilityLabel,
}: ArticleListItemProps) {
  const displayTitle = title.trim() || "제목 없음";

  return (
    <ScalePressable
      testID={`article-list-item-${articleId}`}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ?? getAccessibilityLabel(displayTitle, authorName)
      }
      accessibilityHint={
        onLongPress ? "길게 눌러 추가 동작을 열 수 있어요." : undefined
      }
      accessibilityState={{ disabled, selected }}
      style={styles.container}
      contentStyle={styles.containerContent}
    >
      <ArticleCardCover
        layout="list"
        cover={cover}
        title={displayTitle}
        authorName={authorName?.trim() || undefined}
        borderRadius={16}
      />
      {selected ? (
        <View style={styles.selectedIndicator} pointerEvents="none">
          <Feather name="check" size={16} color={Colors.zinc900} />
        </View>
      ) : null}
    </ScalePressable>
  );
}

export default React.memo(ArticleListItem);

const styles = StyleSheet.create({
  container: {
    marginHorizontal: Spacing.screenPx,
    marginBottom: Spacing.cardGap,
    height: ARTICLE_LIST_ITEM_HEIGHT,
    flexGrow: 0,
    flexShrink: 0,
  },
  containerContent: {
    width: "100%",
    height: ARTICLE_LIST_ITEM_HEIGHT,
    flexGrow: 0,
    flexShrink: 0,
    position: "relative",
    borderRadius: 16,
    backgroundColor: Colors.white,
    ...Shadows.card,
  },
  selectedIndicator: {
    position: "absolute",
    bottom: 12,
    left: 12,
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    backgroundColor: Colors.white,
  },
});
