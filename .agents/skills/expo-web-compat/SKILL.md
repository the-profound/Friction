---
name: expo-web-compat
description: Expo Web 호환성 체크리스트. 화면이나 컴포넌트를 구현·수정할 때마다 참고하여 웹에서 동작하지 않는 API·컴포넌트를 사전에 방지한다.
---

# Expo Web 호환성 가이드

화면이나 컴포넌트를 구현하거나 수정할 때 이 스킬을 참고한다.
**화면 완성 전 반드시 하단의 웹 호환성 체크리스트를 통과해야 한다.**

---

## 1. 웹에서 동작하지 않는 API (No Web Support)

아래 API는 `Platform.OS === 'web'` 일 때 완전히 사용 불가다.
반드시 대체 구현을 제공하거나, 웹에서 렌더링하지 않도록 분기해야 한다.

| API / 라이브러리 | 대체 방법 |
|---|---|
| `expo-battery` | 사용하지 않음 / 웹 Battery API는 지원 범위 외 |
| `expo-brightness` | 미지원. 웹 분기 처리 필요 |
| `expo-contacts` | 미지원. 웹 분기 처리 필요 |
| `expo-device` | 미지원. 웹 분기 처리 필요 |
| `expo-local-authentication` (Face ID/Touch ID) | 미지원. 웹 분기 처리 필요 |
| `expo-location` | 웹 Geolocation API (`navigator.geolocation`) 사용 |
| `expo-media-library` | 미지원. 웹 File/Blob API 사용 |
| `expo-sensors` (Accelerometer 등) | 미지원. 웹 DeviceMotion API 고려 |
| `expo-sharing` | 미지원. 웹 Web Share API (`navigator.share`) 고려 |
| `react-native-keyboard-controller` (`KeyboardAwareScrollView`) | 웹에서는 `ScrollView` 사용 → `KeyboardAwareScrollViewCompat` 참고 |
| `BackHandler` (Android 전용) | 웹에서 호출 시 no-op이므로 직접 분기 불필요. 단, 리스너 등록은 안전함 |

### Platform 분기 패턴

```tsx
import { Platform } from "react-native";

if (Platform.OS !== "web") {
  // 네이티브 전용 코드
} else {
  // 웹 대체 코드
}
```

---

## 2. 웹에서 부분적으로 지원되는 API (Partial Web Support)

| API / 컴포넌트 | 웹 동작 차이 | 주의 사항 |
|---|---|---|
| `expo-camera` | 기본 촬영 가능, `switchCamera` / `recordAsync` 미지원 | 영상 녹화·카메라 전환 기능은 분기 처리 |
| `expo-clipboard` | 읽기/쓰기 일부 제한 | 브라우저 권한 요청 발생 |
| `expo-file-system` | 로컬 파일시스템 접근 불가 | 웹에서는 Blob/URL 방식 사용 |
| `expo-image` | 대부분 동작, 일부 resizeMode 차이 | 웹 테스트 필수 |
| `expo-notifications` | Push 알림 미지원, Local 알림도 제한 | 웹에서 알림 비활성화 분기 |
| `expo-video` | 기본 재생 가능, 일부 고급 API 제한 | |
| `react-native-reanimated` | Layout Animations 미지원, `useNativeDriver: true` 미지원 | 레이아웃 애니메이션은 웹에서 자동으로 무시됨 |
| `FlatList` — `pagingEnabled` | **웹에서 미지원** — 스냅 스크롤이 작동하지 않음 | 웹용 대체 UI 제공 또는 CSS scroll-snap 사용 |
| `FlatList` — `horizontal` + `pagingEnabled` | **웹에서 스냅 동작 안함** — 자유 스크롤이 됨 | `read.tsx` 페이지 슬라이더가 대표 사례 |
| `Modal` | 대부분 동작하나 키보드 인터랙션 차이 | 웹에서 포커스 트랩 직접 구현 필요할 수 있음 |

### Polyfilled APIs (Platform 분기 불필요)

아래 API는 Expo가 자동으로 폴리필을 제공하므로 `Platform.OS` 체크 없이 사용 가능:

- `expo-secure-store`
- `expo-haptics`
- `react-native-maps`
- `Alert`
- `RefreshControl`

---

## 3. 이 프로젝트 전용 웹 Inset 규칙

웹에서는 native safe area 가 없으므로 직접 padding을 적용해야 한다.
**모든 화면에 예외 없이 적용한다.**

```
상단 inset: 67px
하단 inset: 34px
탭바가 있는 경우 탭바 높이: 84px (50px base + 34px bottom inset)
```

### 적용 패턴

```tsx
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function MyScreen() {
  const insets = useSafeAreaInsets();

  // 상단 패딩
  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  // 하단 패딩 (탭바 없는 화면)
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={{ paddingTop: topPadding, paddingBottom: bottomPadding }}>
      {/* ... */}
    </View>
  );
}
```

### 탭바 높이 규칙

- 네이티브: `insets.bottom + 50` (기본 탭바 높이)
- 웹: 84px 고정 (`50 + 34`)
- 이 프로젝트에서는 커스텀 `NavBar` 컴포넌트가 `Spacing.navBarBottom + insets.bottom` 사용
  → 웹에서 `insets.bottom`이 0이므로 `Spacing.navBarBottom` 값이 사실상 탭바 bottom 위치가 됨

### 절대 위치(absolute) 요소의 인셋

절대 위치로 띄워진 헤더나 버튼 컨테이너:

```tsx
const headerTop = Platform.OS === "web" ? 67 : insets.top;
// 헤더 아래 시작하는 콘텐츠
const contentPaddingTop = Platform.OS === "web" ? 67 + headerHeight : insets.top + headerHeight;
```

---

## 4. 이 코드베이스의 기존 패턴 예시

### KeyboardAwareScrollViewCompat

`react-native-keyboard-controller`의 `KeyboardAwareScrollView`는 웹에서 동작하지 않는다.
이 프로젝트는 `artifacts/friction/components/KeyboardAwareScrollViewCompat.tsx`로 래핑한다.

```tsx
// components/KeyboardAwareScrollViewCompat.tsx
import {
  KeyboardAwareScrollView,
  KeyboardAwareScrollViewProps,
} from "react-native-keyboard-controller";
import { Platform, ScrollView, ScrollViewProps } from "react-native";

type Props = KeyboardAwareScrollViewProps & ScrollViewProps;

export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = "handled",
  ...props
}: Props) {
  if (Platform.OS === "web") {
    return (
      <ScrollView keyboardShouldPersistTaps={keyboardShouldPersistTaps} {...props}>
        {children}
      </ScrollView>
    );
  }
  return (
    <KeyboardAwareScrollView
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      {...props}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}
```

**사용법**: `KeyboardAwareScrollView` 대신 항상 `KeyboardAwareScrollViewCompat`을 임포트한다.

### FlatList pagingEnabled — 웹 대체

`pagingEnabled`는 웹에서 동작하지 않는다. (`artifacts/friction/app/read.tsx`의 페이지 슬라이더가 해당 케이스)

```tsx
import { Platform, FlatList, ScrollView } from "react-native";

// 웹에서는 ScrollView 또는 별도 UI로 대체
if (Platform.OS === "web") {
  // 간단한 대체: 스크롤 없이 현재 페이지만 표시
  return <ScrollView>{pages[currentPage]}</ScrollView>;
} else {
  return (
    <FlatList
      horizontal
      pagingEnabled
      data={pages}
      renderItem={...}
    />
  );
}
```

### Platform.select 패턴 (tokens.ts 사례)

```tsx
// artifacts/friction/constants/tokens.ts
import { Platform } from "react-native";

export const Shadows = {
  navBar: Platform.select({
    ios: { shadowColor: "...", shadowOffset: ..., shadowOpacity: ..., shadowRadius: ... },
    android: { elevation: 4 },
    default: {},  // 웹 포함
  }),
};
```

### 네이티브 드라이버 — 웹 주의

```tsx
// react-native-reanimated의 useNativeDriver: true는 웹에서 무시됨
// Animated.timing에서도 웹에서는 useNativeDriver: false가 안전
Animated.timing(value, {
  toValue: 1,
  duration: 300,
  useNativeDriver: true, // 웹에서는 자동으로 false로 처리됨 (경고 발생 가능)
}).start();
```

---

## 5. 화면 완성 전 웹 호환성 체크리스트

화면이나 컴포넌트를 완성하기 전에 아래 항목을 반드시 확인한다.

### 인셋 / 레이아웃

- [ ] 상단에 67px 웹 inset이 적용되어 있는가?
- [ ] 하단에 34px 웹 inset이 적용되어 있는가? (탭바가 있으면 탭바 높이 84px 확인)
- [ ] 절대 위치 요소가 있다면 웹 inset을 반영한 `top`/`bottom` 값인가?
- [ ] `useSafeAreaInsets()`를 사용하고, 웹에서 해당 값이 0임을 감안했는가?

### API 호환성

- [ ] `expo-location`, `expo-contacts`, `expo-sensors` 등 웹 미지원 API를 사용하는가?
  → 사용한다면 `Platform.OS !== 'web'` 분기가 있는가?
- [ ] `react-native-keyboard-controller`의 `KeyboardAwareScrollView`를 직접 사용하는가?
  → `KeyboardAwareScrollViewCompat`으로 교체했는가?
- [ ] `expo-local-authentication` (생체 인증)을 사용하는가?
  → 웹 분기 처리가 있는가?

### FlatList / ScrollView

- [ ] `FlatList`에 `pagingEnabled`를 사용하는가?
  → 웹에서 스냅이 동작하지 않으므로 웹 대체 UI를 제공했는가?
- [ ] `FlatList` boolean props(`scrollEnabled`, `showsVerticalScrollIndicator` 등)에
  문자열이 흘러들어가지 않는가? (타입 강제: `!!someString`)

### 애니메이션

- [ ] Layout Animations(`FadeIn`, `SlideInUp` 등 reanimated)을 사용하는가?
  → 웹에서 무시됨을 허용하거나, 웹 전용 대체를 제공했는가?
- [ ] `useNativeDriver: true`가 붙은 Animated가 있는가?
  → 웹에서 경고 없이 동작하는지 확인

### 기타

- [ ] `Modal`을 사용한다면 웹에서 키보드/포커스 동작을 확인했는가?
- [ ] 네트워크/API 요청에 하드코딩된 로컬 URL이 없는가? (`EXPO_PUBLIC_DOMAIN` 사용)
- [ ] 화면을 웹(`Platform.OS === 'web'`)에서 실제로 렌더링해 레이아웃이 깨지지 않는지 확인했는가?
