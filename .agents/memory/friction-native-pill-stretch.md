---
name: Native pill/capsule vertical stretch
description: Fixed-height is the only reliable fix for capsule buttons stretching vertically on native in Friction
---
Rule: when a pill/capsule button (ScalePressable inside a row) stretches vertically on native, do not rely on flex guards — give an explicit fixed height to the wrapper, the pressable, and the inner content (height + flexGrow/flexShrink 0), centering text with justifyContent instead of paddingVertical.

**Why:** In the 공간 tab filter pills, `alignSelf: "flex-start"` on the wrapper plus `alignItems: "flex-start"` on the row still left the capsules stretched to near full screen height on native (web was fine). ScalePressable's inner view has `flexGrow: 1, alignSelf: "stretch"`, which fills whatever height the pressable is given.

**How to apply:** Define a PILL_HEIGHT constant; set it on all three layers; override inner growth via contentStyle (`flexGrow: 0, height: "100%"`).
