import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Modal, StyleSheet, Text, View } from "react-native";
import { Colors, Typography } from "@/constants/tokens";

export interface SubmitProgressOverlayProps {
  /** Show/hide the overlay. The caller controls mount/unmount on completion or error. */
  visible: boolean;
  /** Primary status line, e.g. "공간을 만드는 중이에요" */
  message: string;
  /** Optional secondary line, e.g. "잠시만 기다려주세요" */
  subMessage?: string;
  testID?: string;
}

const FILL_WIDTH_RATIO = 0.35;
const LOOP_DURATION_MS = 950;

/**
 * Full-screen submission-progress overlay shared by the space-create and
 * space-start flows.
 *
 * There is no real server-side step API (out of scope for this task), so the
 * bar is a pseudo/indeterminate indicator — it communicates "still working",
 * not an actual completion percentage. The caller is responsible for
 * flipping `visible` back to `false` once the submission settles (success or
 * error) so the overlay disappears immediately rather than lingering.
 *
 * Implementation notes (see .agents/skills/expo-web-compat/SKILL.md):
 * - Uses <Modal transparent> so the overlay always covers headers/footers
 *   regardless of caller layout, matching this codebase's existing
 *   ConfirmModal pattern (see app/of-space-start.tsx).
 * - The indeterminate bar animates a `transform: translateX` (not `width`/
 *   `left`) so it can run on the native driver on iOS/Android and still
 *   behaves correctly with the JS driver fallback on web — no
 *   Platform.OS branching needed.
 * - The fill's travel distance is derived from the track's measured width
 *   via onLayout instead of percentage-based transforms, which RN does not
 *   reliably support outside of web.
 */
export default function SubmitProgressOverlay({
  visible,
  message,
  subMessage,
  testID,
}: SubmitProgressOverlayProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible || trackWidth <= 0) return;
    progress.setValue(0);
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: LOOP_DURATION_MS,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => {
      loop.stop();
      progress.setValue(0);
    };
  }, [visible, trackWidth, progress]);

  if (!visible) return null;

  const fillWidth = trackWidth * FILL_WIDTH_RATIO;
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-fillWidth, trackWidth],
  });

  return (
    <Modal visible={visible} transparent animationType="fade" testID={testID}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <ActivityIndicator size="large" color={Colors.zinc700} />
          <Text style={styles.message}>{message}</Text>
          {subMessage ? <Text style={styles.subMessage}>{subMessage}</Text> : null}
          <View
            style={styles.track}
            onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
          >
            {trackWidth > 0 && (
              <Animated.View
                style={[
                  styles.fill,
                  { width: fillWidth, transform: [{ translateX }] },
                ]}
              />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  card: {
    width: "100%",
    maxWidth: 320,
    backgroundColor: Colors.white,
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 12,
  },
  message: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc800,
    textAlign: "center",
  },
  subMessage: {
    ...Typography.caption,
    color: Colors.zinc500,
    textAlign: "center",
    marginTop: -6,
  },
  track: {
    width: "100%",
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.zinc100,
    overflow: "hidden",
    marginTop: 8,
  },
  fill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.zinc700,
  },
});
