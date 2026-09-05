import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getServerVersion } from "@workspace/api-client-react";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import { runtimeConfig } from "@/lib/runtimeConfig";
import { getReleaseDiagnosticContext } from "@/lib/authDiagnostics";
import {
  evaluateServerVersionError,
  evaluateServerVersionResult,
  type ServerVersionEvaluation,
} from "@/lib/serverVersionCheck";

/**
 * Mounted once at the app root (see app/_layout.tsx). Checks the connected
 * API server's advertised build/feature set exactly once per app launch:
 *  - If the server is missing a feature this app build needs (or predates
 *    the /version endpoint entirely), shows one shared "app and server
 *    version don't match" notice instead of letting the gap surface as
 *    scattered, unexplained per-feature failures.
 *  - In development/preview builds only, also renders a small fixed
 *    diagnostic badge with the connected API host and server build id, so a
 *    repeat of this exact incident (deployed server behind dev) is visible
 *    immediately instead of being re-diagnosed from scratch.
 */
export default function ServerVersionGate() {
  const insets = useSafeAreaInsets();
  const [evaluation, setEvaluation] = useState<ServerVersionEvaluation | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!runtimeConfig.apiBaseUrl) return;
    let cancelled = false;

    getServerVersion()
      .then((version) => {
        if (!cancelled) setEvaluation(evaluateServerVersionResult(version));
      })
      .catch((error) => {
        if (!cancelled) setEvaluation(evaluateServerVersionError(error));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const showMismatchNotice = !dismissed && evaluation?.status === "mismatch";
  const isNonProductionBuild = getReleaseDiagnosticContext().track !== "production";
  const buildLabel =
    evaluation === null ? "확인 중" : (evaluation.buildId ?? "확인 불가");
  const badgeBottom = 8 + (Platform.OS === "web" ? 34 : insets.bottom);

  return (
    <>
      <ConfirmModal
        visible={showMismatchNotice}
        title="앱과 서버 버전이 맞지 않아요"
        description="일부 기능을 사용할 수 없을 수 있어요. 앱을 최신 버전으로 업데이트하거나 잠시 후 다시 시도해주세요."
        cancelLabel="확인"
        onCancel={() => setDismissed(true)}
      />
      {isNonProductionBuild ? (
        <View
          style={[styles.badge, { bottom: badgeBottom }]}
          pointerEvents="none"
        >
          <Text style={styles.badgeText} numberOfLines={1}>
            API {runtimeConfig.apiBaseUrl ?? "미설정"}
          </Text>
          <Text style={styles.badgeText} numberOfLines={1}>
            서버 빌드 {buildLabel}
          </Text>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    left: 8,
    maxWidth: 260,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.55)",
    zIndex: 9999,
  },
  badgeText: {
    fontSize: 10,
    color: "#FFFFFF",
  },
});
