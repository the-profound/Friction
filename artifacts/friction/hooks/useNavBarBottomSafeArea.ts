import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Spacing, Sizing } from "@/constants/tokens";

/**
 * Bottom safe area clearance needed for content/CTAs/FABs that must clear the NavBar.
 *
 * Formula: insets.bottom + navBarBottom gap + navBarHeight + extraGap
 *
 * Use this everywhere instead of the static `Spacing.navBarPaddingBottom` so the
 * value correctly adapts to the device's home-indicator safe-area inset.
 *
 * @param extraGap  Additional gap above the NavBar top edge (default 20 — same as the
 *                  static token so existing spacing is preserved while becoming dynamic).
 */
export function useNavBarBottomSafeArea(extraGap = 20): number {
  const insets = useSafeAreaInsets();
  return insets.bottom + Spacing.navBarBottom + Sizing.navBarHeight + extraGap;
}
