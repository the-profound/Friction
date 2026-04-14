---
name: expo-web-compat
description: 화면·컴포넌트를 신규 작성하거나 수정할 때 반드시 읽어야 한다. Expo Web/iOS/Android 플랫폼별 호환성 체크리스트. 웹에서 동작하지 않는 API·컴포넌트를 사전에 방지하고, iOS/Android 전용 주의사항을 확인한다.
---

# Expo 플랫폼 호환성 가이드

**화면이나 컴포넌트를 신규 작성하거나 수정할 때 반드시 이 스킬을 읽고 하단 체크리스트를 통과해야 한다.**
웹(Web), iOS, Android 각 플랫폼별로 동작이 다른 API와 패턴을 정리한다.

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
| `PanResponder` | 터치 이벤트 기반으로 웹에서 마우스 이벤트와 동작 차이 있음 | 웹에서 드래그·스와이프 제스처가 예상과 다르게 동작할 수 있음 |

### Polyfilled APIs (Platform 분기 불필요)

아래 API는 Expo가 자동으로 폴리필을 제공하므로 `Platform.OS` 체크 없이 사용 가능:

- `expo-secure-store`
- `expo-haptics`
- `react-native-maps`
- `Alert`
- `RefreshControl`

---

## 3. iOS 전용 주의사항

iOS에서만 동작하거나, iOS와 Android 동작이 다른 API·스타일 속성 목록이다.

| API / 속성 | iOS 동작 | Android 대체 / 주의 |
|---|---|---|
| `shadowColor`, `shadowOffset`, `shadowOpacity`, `shadowRadius` | iOS에서만 shadow 스타일 적용됨 | Android는 `elevation` 사용. 웹은 `boxShadow` CSS 또는 무시 |
| `DatePickerIOS` | iOS 전용 (deprecated) | `@react-native-community/datetimepicker` 사용 권장 |
| `ActionSheetIOS` | iOS 전용 액션 시트 | Android는 커스텀 Modal 또는 `react-native-action-sheet` 사용 |
| `Vibration.vibrate(pattern)` | iOS는 패턴 진동 미지원, 단순 진동만 | Android는 패턴 배열 지원. `expo-haptics` 사용 권장 |
| `KeyboardAvoidingView` `behavior="padding"` | iOS에서는 `padding` 동작 | Android는 `height` 또는 `position` 권장 |
| `ScrollView` `bounces` | iOS 전용 bounce 효과 | Android 무시됨 |
| `TextInput` `clearButtonMode` | iOS 전용 우측 X 버튼 | Android 미지원 |
| `StatusBar` `barStyle` | iOS에서 `light-content` / `dark-content` | Android는 배경색 별도 설정 필요 |

### iOS shadow 패턴 (이 프로젝트 적용 방식)

```tsx
// artifacts/friction/constants/tokens.ts 에서 사용 중인 패턴
import { Platform } from "react-native";

export const Shadows = {
  navBar: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.13,
      shadowRadius: 12,
    },
    android: {
      elevation: 8,
    },
    default: {}, // 웹 포함 — shadow 없음
  }),
};
```

**규칙**: shadow 속성은 반드시 `Platform.select`로 iOS/Android/default를 분기하고, `default: {}`로 웹에서 빈 객체를 반환한다.

---

## 4. Android 전용 주의사항

Android에서만 동작하거나 웹/iOS와 동작 차이가 있는 API·속성 목록이다.

| API / 속성 | Android 동작 | iOS/웹 주의 |
|---|---|---|
| `elevation` | Android 그림자 효과 (z축 높이) | iOS 무시됨 — iOS는 `shadow*` 속성 사용 |
| `BackHandler` | 하드웨어 백 버튼 핸들링 | iOS/웹 미지원 — 웹에서는 no-op이지만 리스너 등록은 안전 |
| `ToastAndroid` | Android 전용 토스트 메시지 | iOS/웹 미지원 — 크로스 플랫폼 토스트 라이브러리 사용 |
| `StatusBar` `backgroundColor` | Android 전용 상태바 배경색 prop | iOS 무시됨 |
| `StatusBar` `translucent` | Android 전용 반투명 상태바 | iOS는 기본적으로 반투명 |
| `PanResponder` 터치 인식 | 터치 이벤트 기반 | 웹에서는 마우스 이벤트와 혼용되어 `onMoveShouldSetPanResponder` 판단이 다를 수 있음 |
| `Animated` + `useNativeDriver: true` | 네이티브 스레드에서 실행되어 성능 우수 | 웹에서 JS 드라이버로 동작하며 환경에 따라 경고 발생 가능 |
| `android_ripple` (Pressable) | Android 리플 효과 | iOS/웹 무시됨 |
| `StyleSheet` `includeFontPadding` | Android 전용 폰트 패딩 제거 | iOS/웹 무시됨 |

### BackHandler 패턴 (read.tsx 사례)

```tsx
// artifacts/friction/app/read.tsx 에서 사용 중인 패턴
import { BackHandler } from "react-native";

useEffect(() => {
  if (mode !== "basic") return;
  // BackHandler는 Android에서만 실제로 동작하며,
  // 웹/iOS에서는 no-op이므로 Platform 분기 없이 사용 가능
  const sub = BackHandler.addEventListener("hardwareBackPress", () => {
    if (!reading.canExit) {
      Alert.alert("읽기 중", "완독 후 보관/삭제를 선택해주세요.");
      return true;
    }
    return false;
  });
  return () => sub.remove();
}, [mode, reading.canExit]);
```

---

## 5. 이 프로젝트 전용 웹 Inset 규칙

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

## 6. 이 코드베이스의 기존 패턴 예시

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
  useNativeDriver: true, // 웹에서 JS 드라이버로 동작하며 환경에 따라 경고 발생 가능
}).start();
```

### SwipeableRow — PanResponder + Animated.spring 플랫폼 주의사항

`artifacts/friction/components/SwipeableRow/SwipeableRow.tsx`는 `PanResponder`와 `Animated.spring`(`useNativeDriver: true`)을 사용한 스와이프 삭제 컴포넌트다.

**플랫폼별 동작 차이:**

| 항목 | iOS/Android | 웹 |
|---|---|---|
| `PanResponder` 제스처 인식 | 터치 이벤트 기반으로 정상 동작 | 마우스 이벤트 기반 — 드래그 시 `onMoveShouldSetPanResponder`가 예상보다 늦게 발화될 수 있음 |
| `Animated.spring` + `useNativeDriver: true` | 네이티브 스레드에서 고성능 실행 | 웹에서 JS 드라이버로 동작하며 환경에 따라 경고 발생 가능 |
| 스와이프 삭제 UX | 터치 드래그로 자연스럽게 동작 | 마우스 드래그로 동작하나, 모바일 대비 UX 차이 발생 가능 |

```tsx
// SwipeableRow.tsx — 웹에서 마우스 이벤트로 동작함을 인지하고 사용할 것
const panResponder = useRef(
  PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) => {
      const { dx, dy } = gestureState;
      return Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 5;
    },
    // ...
  })
).current;

// Animated.spring with useNativeDriver: true — 웹에서 JS 드라이버로 동작하며 환경에 따라 경고 발생 가능
Animated.spring(translateX, {
  toValue,
  useNativeDriver: true, // 웹에서 JS 드라이버로 폴백
  bounciness: 0,
  speed: 20,
}).start();
```

**웹에서 스와이프 기능이 필요하지 않다면** `Platform.OS !== 'web'` 조건으로 `SwipeableRow` 렌더링을 분기하는 것을 고려한다.

### BottomSheet — Animated.spring + PanResponder 웹 주의사항

`artifacts/friction/components/BottomSheet/BottomSheet.tsx`는 `Modal`, `PanResponder`, `Animated.spring`(`useNativeDriver: true`)을 조합한 컴포넌트다.

**플랫폼별 동작 차이:**

| 항목 | iOS/Android | 웹 |
|---|---|---|
| `Modal` | 네이티브 Modal로 화면 전체 오버레이 | DOM 기반 렌더링. 키보드 포커스 트랩이 자동으로 동작하지 않을 수 있음 |
| `PanResponder` 드래그 닫기 | 터치 드래그로 자연스럽게 작동 | 마우스 드래그로 동작하나 UX 차이 있음 |
| `Animated.spring` + `useNativeDriver: true` | 네이티브 스레드 애니메이션 | 웹에서 JS 드라이버로 동작하며 환경에 따라 경고 발생 가능 |
| `Dimensions.get("window").height` | 실제 화면 높이 반환 | 브라우저 뷰포트 높이 반환 — 모바일 앱과 값이 다를 수 있음 |

```tsx
// BottomSheet.tsx — 사용 시 주의사항
// 1. Modal transparent + statusBarTranslucent는 Android 전용 효과
// 2. useNativeDriver: true — 웹에서 JS 드라이버로 동작하며 환경에 따라 경고 발생 가능
Animated.spring(translateY, {
  toValue: getSnapY(0),
  useNativeDriver: true, // 웹에서 JS 드라이버로 폴백
  damping: 20,
  stiffness: 200,
}).start();
```

### SelectableText — 플랫폼별 완전 분기 패턴

`artifacts/friction/components/SelectableText/SelectableText.tsx`는 웹과 네이티브를 완전히 분기한 대표 사례다.

```tsx
// SelectableText.tsx — Platform.OS별 완전 분기
export default function SelectableText(props: SelectableTextProps) {
  if (Platform.OS === "web") {
    return <SelectableTextWeb {...props} />;   // window.getSelection() 사용
  }
  return <SelectableTextNative {...props} />;  // TextInput + onSelectionChange 사용
}
```

**웹 구현 (`SelectableTextWeb`):**
- `window.getSelection()` + `document.addEventListener("selectionchange")` 사용
- `Text` 컴포넌트의 `selectable` prop으로 텍스트 선택 가능
- DOM ref로 선택 영역이 컴포넌트 내부인지 확인

**네이티브 구현 (`SelectableTextNative`):**
- `TextInput`을 `editable={false}`로 사용하여 선택 이벤트만 획득
- `onSelectionChange`로 선택 범위(start/end) 추적
- `children`이 있을 때는 투명 오버레이 `TextInput`으로 선택 이벤트 캡처

**이 패턴을 새 컴포넌트에 적용할 때:**

```tsx
// 플랫폼 분기가 복잡해질 경우 이처럼 완전 분리 권장
function MyComponentWeb(props) { /* 웹 전용 구현 */ }
function MyComponentNative(props) { /* 네이티브 전용 구현 */ }

export default function MyComponent(props) {
  if (Platform.OS === "web") return <MyComponentWeb {...props} />;
  return <MyComponentNative {...props} />;
}
```

### read.tsx — PanResponder 스와이프 페이지네이션 웹 주의사항

`artifacts/friction/app/read.tsx`의 `swipePanResponder`는 좌우 스와이프로 페이지를 넘기고, 위 스와이프로 메모 시트를 여는 복합 제스처 핸들러다.

- **웹**: 마우스 드래그 이벤트로 동작. `isTextSelectingRef`로 텍스트 선택 중 스와이프 방지 처리가 되어 있으나, 웹에서 `SelectableTextWeb`의 `window.getSelection()` 이벤트와 충돌 가능성 있음
- **`useNativeDriver: true`**: 웹에서 JS 드라이버로 동작하며 환경에 따라 경고 발생 가능
- **`BackHandler`**: Android 전용 하드웨어 백 버튼 처리. 웹/iOS에서는 no-op

---

## 7. 화면 완성 전 플랫폼 호환성 체크리스트

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
  → 웹에서 JS 드라이버로 동작하며 환경에 따라 경고 발생 가능함을 인지했는가?

### iOS 전용 체크

- [ ] `shadowColor`, `shadowOffset`, `shadowOpacity`, `shadowRadius`를 직접 스타일에 적용했는가?
  → `Platform.select`로 iOS/Android(`elevation`)/default(`{}`) 분기를 했는가?
- [ ] `ActionSheetIOS`, `DatePickerIOS` 등 iOS 전용 API를 사용하는가?
  → Android/웹 대체 구현이 있는가?
- [ ] `KeyboardAvoidingView`의 `behavior` prop이 iOS에서 `"padding"`으로 설정되어 있는가?
  → Android에서는 `"height"` 또는 `"position"`이 더 안정적이다.

### Android 전용 체크

- [ ] `elevation`을 사용하는가?
  → iOS에서는 무시됨. `Platform.select`로 iOS shadow와 함께 정의했는가?
- [ ] `BackHandler`를 사용하는가?
  → Android 전용임을 인지하고, iOS/웹에서 no-op임을 확인했는가?
- [ ] `ToastAndroid`를 사용하는가?
  → iOS/웹 대체 토스트 구현이 있는가?
- [ ] `StatusBar`에 `backgroundColor`나 `translucent`를 설정하는가?
  → Android 전용임을 인지했는가?

### PanResponder / 제스처

- [ ] `PanResponder`를 사용하는가?
  → 웹에서 마우스 이벤트로 동작함을 인지하고, 웹 UX가 허용 가능한 수준인지 확인했는가?
  → 웹에서 제스처가 불필요하다면 `Platform.OS !== 'web'` 분기를 고려했는가?
- [ ] `SwipeableRow`를 사용하는가?
  → 웹에서 마우스 드래그로 동작함을 확인했는가?
- [ ] `BottomSheet`를 사용하는가?
  → 웹에서 Modal 포커스 트랩과 드래그 UX를 확인했는가?

### 기타

- [ ] `Modal`을 사용한다면 웹에서 키보드/포커스 동작을 확인했는가?
- [ ] 네트워크/API 요청에 하드코딩된 로컬 URL이 없는가? (`EXPO_PUBLIC_DOMAIN` 사용)
- [ ] 화면을 웹(`Platform.OS === 'web'`)에서 실제로 렌더링해 레이아웃이 깨지지 않는지 확인했는가?
