import React, { createContext, useCallback, useContext } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from "react-native-reanimated";

interface ReaderTransitionContextValue {
  startFadeToBlack: (onComplete: () => void) => void;
}

const ReaderTransitionContext = createContext<ReaderTransitionContextValue | null>(null);

export function ReaderTransitionProvider({ children }: { children: React.ReactNode }) {
  const overlayOpacity = useSharedValue(0);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const startFadeToBlack = useCallback(
    (onComplete: () => void) => {
      const doAll = () => {
        onComplete();
        // Reader screen starts with its own black overlay (value=1),
        // so resetting here causes no visual flash.
        setTimeout(() => {
          overlayOpacity.value = 0;
        }, 300);
      };

      overlayOpacity.value = withTiming(
        1,
        { duration: 700, easing: Easing.in(Easing.ease) },
        (finished) => {
          if (finished) {
            runOnJS(doAll)();
          } else {
            overlayOpacity.value = withTiming(0, { duration: 300 });
          }
        },
      );
    },
    [overlayOpacity],
  );

  return (
    <ReaderTransitionContext.Provider value={{ startFadeToBlack }}>
      {children}
      <Animated.View
        style={[StyleSheet.absoluteFillObject, styles.overlay, overlayStyle]}
        pointerEvents="none"
      />
    </ReaderTransitionContext.Provider>
  );
}

export function useReaderTransition(): ReaderTransitionContextValue {
  const ctx = useContext(ReaderTransitionContext);
  if (!ctx) throw new Error("useReaderTransition must be used within ReaderTransitionProvider");
  return ctx;
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: "black",
    zIndex: 9999,
  },
});
