import { ReactNode } from "react";
import { ScrollView, RefreshControl, StyleProp, ViewStyle } from "react-native";
import { Colors } from "@/constants/tokens";

type Props = {
  refreshing: boolean;
  onRefresh: () => void;
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
};

export default function RefreshableEmpty({
  refreshing,
  onRefresh,
  children,
  contentContainerStyle,
  style,
}: Props) {
  return (
    <ScrollView
      style={[{ flex: 1 }, style]}
      contentContainerStyle={[{ flexGrow: 1 }, contentContainerStyle]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={Colors.zinc400}
        />
      }
      showsVerticalScrollIndicator={false}
      alwaysBounceVertical
    >
      {children}
    </ScrollView>
  );
}
