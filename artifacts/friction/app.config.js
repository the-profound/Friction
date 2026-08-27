const { createHash } = require("node:crypto");

const buildProfile = process.env.EAS_BUILD_PROFILE;
const releaseTrack =
  buildProfile === "preview" || buildProfile === "production" || buildProfile === "development"
    ? buildProfile
    : process.env.APP_VARIANT === "preview"
      ? "preview"
      : process.env.APP_VARIANT === "development"
        ? "development"
        : "production";
const IS_DEV = releaseTrack === "development";
const IS_PREVIEW = releaseTrack === "preview";

function releaseFingerprint(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function parseReleaseHostname(value, allowDomainOnly = false) {
  const trimmed = value?.trim().toLowerCase();
  if (
    !trimmed ||
    trimmed === "placeholder" ||
    trimmed === "placeholder-anon-key" ||
    trimmed === "configuration-invalid" ||
    trimmed === "undefined" ||
    trimmed === "null"
  ) {
    return null;
  }
  const normalized =
    allowDomainOnly && !/^https?:\/\//i.test(trimmed) ? `https://${trimmed}` : trimmed;
  try {
    const url = new URL(normalized);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.hostname.includes("placeholder") ||
      url.hostname.endsWith(".invalid")
    ) {
      return null;
    }
    return url.hostname;
  } catch {
    return null;
  }
}

function buildReleaseDiagnostics() {
  const supabaseHost = parseReleaseHostname(process.env.EXPO_PUBLIC_SUPABASE_URL);
  const apiHost = parseReleaseHostname(process.env.EXPO_PUBLIC_DOMAIN, true);
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const anonKeyFingerprint =
    anonKey &&
    !["placeholder", "placeholder-anon-key", "configuration-invalid", "undefined", "null"].includes(
      anonKey.toLowerCase(),
    )
      ? releaseFingerprint(anonKey)
      : null;
  const configurationFingerprint =
    supabaseHost && apiHost && anonKeyFingerprint
      ? releaseFingerprint(
          `${releaseTrack}|${supabaseHost}|${apiHost}|${anonKeyFingerprint}`,
        )
      : null;

  return {
    track: releaseTrack,
    supabaseHost,
    apiHost,
    configurationFingerprint,
  };
}

function validateEasReleaseEnvironment() {
  const profile = process.env.EAS_BUILD_PROFILE;
  if (profile !== "preview" && profile !== "production") return;
  if (process.env.APP_RELEASE_TRACK !== profile) {
    throw new Error(
      `Release track does not match EAS ${profile}. APP_RELEASE_TRACK must be ${profile}.`,
    );
  }

  const missing = [
    "EXPO_PUBLIC_SUPABASE_URL",
    "EXPO_PUBLIC_SUPABASE_ANON_KEY",
    "EXPO_PUBLIC_DOMAIN",
  ].filter((name) => {
    const value = process.env[name]?.trim().toLowerCase() ?? "";
    return (
      value === "" ||
      value === "placeholder" ||
      value === "placeholder-anon-key" ||
      value === "undefined" ||
      value === "null"
    );
  });

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? "";
  try {
    const url = new URL(supabaseUrl);
    if (
       url.protocol !== "https:" ||
      !url.hostname ||
      url.hostname.toLowerCase().includes("placeholder") ||
      url.hostname.toLowerCase().endsWith(".invalid") ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      missing.push("EXPO_PUBLIC_SUPABASE_URL");
    }
  } catch {
    missing.push("EXPO_PUBLIC_SUPABASE_URL");
  }

  const domain = process.env.EXPO_PUBLIC_DOMAIN?.trim() ?? "";
  const normalizedDomain = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
  try {
    const url = new URL(normalizedDomain);
    if (
      !url.hostname ||
      url.hostname.toLowerCase().includes("placeholder") ||
      url.hostname.toLowerCase().endsWith(".invalid") ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      missing.push("EXPO_PUBLIC_DOMAIN");
    }
  } catch {
    missing.push("EXPO_PUBLIC_DOMAIN");
  }

  if (missing.length > 0) {
    throw new Error(
      `Release configuration is incomplete for EAS ${profile}: ${[
        ...new Set(missing),
      ].join(", ")}. Values are intentionally not printed.`,
    );
  }
}

validateEasReleaseEnvironment();
const releaseDiagnostics = buildReleaseDiagnostics();

module.exports = {
  expo: {
    name: IS_DEV ? "Friction Dev" : IS_PREVIEW ? "Friction Preview" : "Friction",
    slug: IS_DEV ? "friction-dev" : "friction",
    version: "1.0.0",
    orientation: "portrait",
    icon: IS_DEV
      ? "./assets/images/splash-icon.png"
      : "./assets/images/wax-seal.png",
    scheme: IS_DEV ? "friction-dev" : "friction",
    userInterfaceStyle: "automatic",
    ios: {
      supportsTablet: false,
      bundleIdentifier: IS_DEV
        ? "com.theprofound.friction"
        : "friction.by.theprofound",
      appleTeamId: "D9P94YPN8F",
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        UIBackgroundModes: ["remote-notification"],
      },
      entitlements: {
        // Required for expo-notifications to access APNs and its Keychain entries.
        // Without this, ServerRegistrationModule.swift throws errSecMissingEntitlement
        // (-34018) when reading push-registration data from Keychain on launch,
        // which propagates through the TurboModule layer as an RCTFatal crash.
        //
        // Both dev and production profiles use distribution:"store" (TestFlight),
        // so the provisioning profile is always an App Store profile → always "production".
        "aps-environment": "production",
      },
      buildNumber: "17",
    },
    android: {
      softwareKeyboardLayoutMode: "resize",
      package: IS_DEV ? "com.theprofound.friction" : "friction.by.theprofound",
      permissions: [
        "android.permission.RECORD_AUDIO",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
        "android.permission.READ_MEDIA_IMAGES",
        "android.permission.READ_MEDIA_VIDEO",
        "android.permission.READ_MEDIA_AUDIO",
        "android.permission.RECEIVE_BOOT_COMPLETED",
        "android.permission.VIBRATE",
        "android.permission.POST_NOTIFICATIONS",
      ],
    },
    web: {
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      "expo-dev-client",
      [
        "expo-router",
        {
          origin: "https://replit.com/",
        },
      ],
      [
        "expo-font",
        {
          fonts: [
            "./node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Feather.ttf",
            "./node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf",
          ],
        },
      ],
      [
        "expo-image-picker",
        {
          photosPermission:
            "글에 사진을 첨부하려면 사진첩 접근 권한이 필요합니다.",
          cameraPermission:
            "글에 사진을 첨부하려면 카메라 접근 권한이 필요합니다.",
        },
      ],
      [
        "expo-media-library",
        {
          photosPermission:
            "글을 이미지로 저장하려면 사진첩 접근 권한이 필요합니다.",
          savePhotosPermission:
            "글을 이미지로 저장하려면 사진첩 접근 권한이 필요합니다.",
          isAccessMediaLocationEnabled: false,
        },
      ],
      "expo-web-browser",
      "expo-asset",
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          resizeMode: "contain",
          backgroundColor: "#ffffff",
        },
      ],
      "@react-native-community/datetimepicker",
      "expo-secure-store",
      [
        "expo-notifications",
        {
          iosDisplayInForeground: false,
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      releaseDiagnostics,
      eas: {
        projectId: IS_DEV
          ? "bfb7f9ff-060d-4e45-af6a-621b1be92e93"
          : "18ce6a9e-317c-4f64-adc1-182e152d41e3",
      },
    },
  },
};
