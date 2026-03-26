import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, Typography, ZIndex, Spacing } from "../../constants/tokens";
import { useToast, type ToastType } from "../../contexts/ToastContext";

const TYPE_CONFIG: Record<ToastType, { icon: keyof typeof Feather.glyphMap; bg: string; iconColor: string }> = {
  success: { icon: "check-circle", bg: "#ECFDF5", iconColor: "#059669" },
  error: { icon: "alert-circle", bg: "#FEF2F2", iconColor: "#DC2626" },
  info: { icon: "info", bg: "#EFF6FF", iconColor: "#2563EB" },
};

export default function ToastContainer() {
  const { toasts, removeToast } = useToast();
  const insets = useSafeAreaInsets();

  const bottomToasts = toasts.filter((t) => t.position === "bottom");
  const topToasts = toasts.filter((t) => t.position === "top");

  return (
    <View style={styles.root} pointerEvents="box-none">
      <View style={[styles.topContainer, { top: insets.top + 8 }]} pointerEvents="box-none">
        {topToasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
        ))}
      </View>
      <View style={[styles.bottomContainer, { bottom: Spacing.navBarPaddingBottom + 8 }]} pointerEvents="box-none">
        {bottomToasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
        ))}
      </View>
    </View>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: { id: number; message: string; type: ToastType; action?: { label: string; onPress: () => void } };
  onDismiss: () => void;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;
  const config = TYPE_CONFIG[toast.type];

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[styles.item, { backgroundColor: config.bg, opacity, transform: [{ translateY }] }]}>
      <Feather name={config.icon} size={18} color={config.iconColor} />
      <Text style={styles.message} numberOfLines={2}>
        {toast.message}
      </Text>
      {toast.action && (
        <Pressable
          onPress={() => {
            toast.action!.onPress();
            onDismiss();
          }}
          hitSlop={8}
        >
          <Text style={[styles.actionLabel, { color: config.iconColor }]}>{toast.action.label}</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: ZIndex.toast,
    pointerEvents: "box-none",
  },
  topContainer: {
    position: "absolute",
    left: Spacing.screenPx,
    right: Spacing.screenPx,
    alignItems: "center",
    gap: 8,
  },
  bottomContainer: {
    position: "absolute",
    left: Spacing.screenPx,
    right: Spacing.screenPx,
    alignItems: "center",
    gap: 8,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 10,
    width: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  message: {
    flex: 1,
    ...Typography.body,
    color: Colors.zinc900,
    fontSize: 14,
  },
  actionLabel: {
    ...Typography.bodySemiBold,
    fontSize: 14,
  },
});
