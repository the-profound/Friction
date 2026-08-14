const IS_DEV = process.env.APP_VARIANT === "development";

module.exports = {
  expo: {
    name: IS_DEV ? "Friction Dev" : "Friction",
    slug: IS_DEV ? "friction-dev" : "friction",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
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
      package: "com.theprofound.friction",
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
      eas: {
        projectId: IS_DEV
          ? "bfb7f9ff-060d-4e45-af6a-621b1be92e93"
          : "18ce6a9e-317c-4f64-adc1-182e152d41e3",
      },
    },
  },
};
