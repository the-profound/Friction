# Friction 타이포그래피·텍스트 정렬 기준

이 문서는 화면 UI 텍스트와 글 본문(작성·분할·마감·읽기)의 **현재 설정값, 계산식,
책임 경계**를 한곳에 모은 유지보수 안내서다. 새 값을 정하거나 가독성 최소선을
판정하는 문서가 아니다.

- UI 텍스트의 최소 크기·색·웨이트와 자동 검사는
  [타이포그래피 최소 가독성 규칙](./typography-rules.md)을 참고한다.
- 물리 기기 inset, 웹 fallback, NavBar 회피 여백은 별도의 **안전 영역 계산 기준**
  문서의 책임이다. 여기의 `safeAreaWidth`/`safeAreaHeight`는 기기 safe area가
  아니라 리더 카드 안에서 본문을 배치하기 위한 가상 박스다.

본문의 줄바꿈은 콘텐츠만으로 결정되지 않는다. 같은 `containerWidth`, 텍스트 컬럼
폭, 글꼴, 글자 크기, 행간, 자간, 줄바꿈 규칙이 함께 같아야 작성 중 측정한 페이지와
마감 미리보기·읽기 결과가 일치한다.

---

## 1. 설정의 소유자와 소비 지점

| 책임 | 기준 소스 | 소비자 | 바꿀 때 같이 볼 곳 |
| --- | --- | --- | --- |
| 일반 UI 토큰·가독성 하한 | `constants/tokens.ts`의 `Typography`, `ReadabilityMinimums` | React Native 화면과 공용 컴포넌트 | `docs/typography-rules.md`, UI가 있는 iOS/Android/Web |
| 리더 카드 비율·본문 척도 | `constants/tokens.ts`의 `ReaderTokens` | `lib/bodyLayout.ts`, 읽기/에디터 레이아웃 | 작성, 분할, 마감, 읽기 |
| 본문 컬럼과 메트릭 계산 | `lib/bodyLayout.ts` | `useEditorLayout`, `on-01c.tsx`, `read.tsx` | 네 화면의 같은 컨테이너 폭 |
| 작성/분할 화면의 화면 폭 연결 | `lib/useEditorLayout.ts` | `app/on-01a.tsx` | 작성 후 분할·마감·읽기 |
| 본문 블록 CSS의 기준 | `components/shared/bodyTypographyCss.ts` | 네이티브 리더, 측정 레이어 | 리더와 페이지 분할 측정 |
| 네이티브 편집 DOM | `components/WebViewMarkdownEditor/editorHtml.ts`, `editorWebviewSrc/` | `on-01a.tsx`의 WebView 에디터 | 작성/분할의 입력·내보내기 |
| 네이티브 읽기 DOM | `components/WebViewMarkdownReader/readerHtml.ts` | `read.tsx`, `on-01c.tsx` 미리보기 | 읽기와 마감 미리보기 |
| 페이지 높이 측정 DOM | `components/WebViewMeasureLayer/measureHtml.ts` | `on-01a.tsx`의 분할 측정 | 분할 결과와 읽기 결과 |
| 웹 대체 렌더러 | `WebViewMarkdownEditorWeb.tsx`, `WebViewMarkdownReaderWeb.tsx` | Expo Web | Web에서도 변경 대상 블록을 직접 확인 |

`/on-01b`는 독립 렌더러가 아니라 `/on-01a?mode=dividing`으로 넘기는 호환
라우트다. 따라서 문서에서 말하는 **분할 화면**의 에디터·측정 책임은 현재
`on-01a.tsx`에 있다.

### 글꼴 로딩과 fallback

| 범위 | 우선 글꼴 | fallback / 공급 방식 |
| --- | --- | --- |
| 일반 UI | `Pretendard-*` | `Typography`와 `ReaderTokens.fontFamily`의 `Platform.select` 이름을 사용한다. |
| 본문 일반 | `Eulyoo1945-Regular` | `NotoSerifKR_400Regular`, CSS `serif` |
| 본문 강조·제목 | `Eulyoo1945-SemiBold` | `NotoSerifKR_600SemiBold`, CSS `serif` |
| 네이티브 WebView | Eulyoo + Noto Serif KR WOFF2 | `editorFontStore`에서 두 가족의 Regular와 SemiBold를 모두 전달할 때 `@font-face`로 삽입한다. 하나라도 없으면 CSS fallback 체인을 사용한다. |
| 앱 폰트 등록 | Noto Serif KR 400/600/800 | `app/_layout.tsx`에서 Expo 폰트로 등록한다. |

글꼴 파일을 바꾸거나 fallback 순서를 바꾸면, 폰트가 아직 준비되지 않은 WebView와
완전히 로드된 WebView 모두에서 줄 수·분할 위치를 확인한다.

---

## 2. 일반 UI 타이포그래피

단위가 없는 `fontSize`, `letterSpacing` 값은 React Native 논리 px이다. 모든 일반
화면 UI는 가능한 한 아래 토큰을 사용한다. 색의 최소선·예외는 이 문서가 아니라
[`typography-rules.md`](./typography-rules.md)에서 관리한다.

| 토큰 | 글꼴 / 웨이트 | 크기 | 자간 | 대상 |
| --- | --- | ---: | ---: | --- |
| `Typography.headerTitle` | Pretendard Black / 900 | 28 px | -0.5 px | 화면 헤더 |
| `Typography.tabLabel` | Pretendard ExtraLight / 200 | 10 px | 기본값 | 탭 레이블의 승인된 예외 |
| `Typography.dateHeader` | Pretendard SemiBold / 600 | 13 px | 기본값 | 날짜 헤더 |
| `Typography.searchInput` | Pretendard Regular | 14 px | 기본값 | 검색 입력 |
| `Typography.body` | Pretendard Regular | 16 px | 기본값 | 일반 UI 본문 |
| `Typography.bodyMedium`, `bodySemiBold` | Pretendard SemiBold / 600 | 16 px | 기본값 | 강조 UI 본문 |
| `Typography.bodyExtraLight` | Pretendard ExtraLight | 16 px | 기본값 | 큰 장식 텍스트만 |
| `Typography.caption` | Pretendard Regular | 12 px | 기본값 | 보조·메타 |
| `Typography.captionMedium` | Pretendard Medium / 500 | 12 px | 기본값 | 강조 메타 |

`ReadabilityMinimums`의 UI 기본선은 **12 px, Regular 400, 읽을 수 있는 보조
텍스트는 zinc500 이상**이다. 리더 본문은 카드 폭에 비례하는 별도 척도를 사용하므로
이 12 px UI 검사의 예외다. `tabLabel`의 10 px/ExtraLight도 승인된 예외이므로 새
컴포넌트에서 그대로 복제하지 않는다.

---

## 3. 리더·에디터 본문 메트릭과 컬럼

### 기준 토큰과 단위

`ReaderTokens`의 `cqi`는 이 앱에서 CSS container query 단위에 의존하지 않고,
**컨테이너 폭 대비 백분율**로 계산한다.

```text
cqiToPx(cqi, C) = (cqi / 100) × C
```

여기서 `C`는 `containerWidth`다. 작성/분할에서는
`resolveContainerWidth(screenWidth, screenHeight)`가
`min(screenWidth, screenHeight × 5/8)`을 반환한다. 읽기는 저장된
`layoutWidth`가 있으면 그것을 우선 사용하여, 읽는 창의 가용 높이·오버레이 때문에
본문 크기가 달라지지 않게 한다.

| 설정 | 토큰 값 | 실제 계산 / 단위 | 적용 |
| --- | ---: | --- | --- |
| 카드 비율 | `aspectRatio = 5/8` | 폭 : 높이 | 작성·읽기 컨테이너 선택 |
| 내부 가상 박스 폭 | `safeArea.widthCqi = 90` | `0.90 × C` px | 본문 카드 내부 폭 |
| 내부 가상 박스 높이 | `safeArea.heightCqi = 120` | `1.20 × C` px | 분할/페이지 가용 높이 기준 |
| 가로 패딩 | `padding.xCqi = 6` | `0.06 × C` px | 내부 박스 양쪽 |
| 세로 패딩 | `padding.yCqi = 15` | `0.15 × C` px | 내부 박스 위·아래 |
| **텍스트 컬럼 폭** | — | `Math.round(safeAreaWidth - 2 × paddingX)` px | WebView와 측정 레이어의 명시적 `width` |
| 본문 크기 | `typeScale.bodyCqi = 4.0` | `0.04 × C` px | 본문 루트 |
| 제목 크기 | `typeScale.titleCqi = 6.4` | `0.064 × C` px = 본문 `1.6em` | 제목 입력, H1 |
| 본문 행간 | `lineHeight.relaxed = 1.8` | `bodyFontSize × 1.8` px | 본문·문단 |
| 제목 계열 기준 | `lineHeight.tight = 1.2` | 읽기 카드의 UI 제목 등 별도 title 메트릭에 사용 | 본문 H1/H2/H3과 혼동 금지 |
| 본문 자간 | `letterSpacing.relaxedEm = 0.05` | `bodyFontSize × 0.05` px | 본문 루트 |
| 조밀 자간 | `letterSpacing.tightEm = -0.02` | `bodyFontSize × -0.02` px | 읽기 카드의 별도 UI 제목 |

`textColumnWidth`만 정수 px로 반올림한다. `bodyFontSize`,
`bodyLineHeight`, `bodyLetterSpacing`, 패딩은 부동소수 값을 유지해 CSS 변수로
전달한다. 텍스트 컬럼을 `paddingHorizontal`만으로 만들면 Yoga가 부모의 위치와
양쪽 경계를 각각 픽셀에 맞추는 과정에서, 계산상 같은 폭도 실제 자식 폭이 아주
조금 달라질 수 있다. 그래서 **같은 `containerWidth`를 쓰는 경우에 한해**
`Math.round(...)`한 컬럼 폭을 자식의 `width`로 직접 전달한다.

이것은 화면이 달라도 줄바꿈을 무조건 고정하는 기능이 아니다. 예를 들어
`containerWidth` 자체가 390 px에서 430 px로 바뀌면 컬럼도 넓어지므로 줄바꿈이
달라지는 것이 정상이다. 정수화가 해결하는 범위는 같은 컨테이너 폭에서 부모
위치 때문에 발생하는 ±1 px 안팎의 경계 스냅 차이뿐이다.

### 줄바꿈을 계속 일치시키는 방법

줄바꿈과 페이지 경계를 재현해야 하는 흐름은 다음 네 가지를 함께 지킨다.

1. **기준 폭을 고정한다.** 작성 시 사용하는 `containerWidth`를 글의
   `layoutWidth`로 저장하고, 읽기에서는 저장값을 우선 사용한다. 저장값이 없는
   구형 글만 작성 화면과 동일한 `screenHeight × 5/8` fallback을 사용한다.
2. **컬럼 폭 계산을 공유한다.** 작성·분할·마감·읽기 모두
   `computeBodyLayout(containerWidth)`를 거쳐
   `Math.round(safeAreaWidth - 2 × paddingX)`를 얻는다. 측정 WebView, 편집
   WebView, 리더 WebView의 실제 텍스트 자식에도 그 값을 `width`로 준다.
3. **폰트 메트릭은 같은 값으로 주입한다.** `bodyFontSize`,
   `bodyLetterSpacing`, 제목 크기와 공통 CSS의 행간·줄바꿈 규칙을 맞춘다.
   폰트 크기나 자간까지 임의로 정수화하면 오히려 글자 폭이 달라질 수 있으므로
   정수화하지 않는다.
4. **폭 변경과 스케일 변경을 구분한다.** 읽기 카드가 작은 화면에 맞춰
   시각적으로 축소되어도, 본문은 저장된 레이아웃 폭으로 먼저 렌더링한 뒤 카드
   전체를 scale한다. 이렇게 하면 화면에 맞추기 위한 축소가 본문을 다시
   reflow하지 않는다. 반대로 사용자가 새 폭으로 글을 다시 편집하면 새 폭의
   줄바꿈을 다시 측정하고 페이지를 재분할해야 한다.

따라서 “정수 px로 변경하면 줄바꿈이 계속 달라지는가?”에 대한 답은 다음과 같다.
**정수화 자체는 줄바꿈을 계속 바꾸지 않는다.** 입력 폭이 같은 상태에서는 경계
스냅을 한 값으로 결정해 오히려 재현성을 높인다. 줄바꿈이 달라진다면 먼저
`containerWidth`/`layoutWidth`, 실제 자식 `width`, WebView에 주입된 폰트·자간,
부모 scale 적용 시점을 순서대로 비교해야 한다. 실제 DOM 폭은 WebView의
`getBoundingClientRect().width`로, 페이지 높이는 측정 레이어 결과와 리더의
블록 높이로 확인한다.

### 네 흐름에서의 공통 계약

| 흐름 | 컬럼·메트릭 사용 방식 | 확인할 결과 |
| --- | --- | --- |
| 작성 | `useEditorLayout()` → `computeBodyLayout()` 결과를 에디터와 측정 요청에 전달 | 입력 중 줄바꿈, overflow 강조, 분할 후보 |
| 분할 | 작성 화면의 `mode=dividing`; 측정 레이어가 같은 폭·본문 크기·자간으로 높이를 계산 | 분할 위치와 페이지 높이 |
| 마감 | `on-01c.tsx`가 저장된 `layoutWidth`로 `computeBodyLayout()`을 다시 계산하고 리더를 축소 렌더링 | 미리보기가 저장된 줄바꿈을 보존 |
| 읽기 | `read.tsx`가 저장된 `layoutWidth`(없으면 작성과 같은 폭 계산)를 사용하고 리더에 본문/제목 메트릭을 전달 | 마감 미리보기 및 분할 결과와 같은 줄·페이지 |

분할의 `WebViewMeasureLayer`는 블록 마진을 0으로 만든 뒤 React Native 측
`blockGap`을 높이에 더하는 측정 전용 계약을 쓴다. 화면에 보이는 리더의 여백과
같은 CSS `margin`을 측정기에 다시 더하지 않는다.

---

## 4. 본문 블록별 정렬·여백·줄바꿈 정책

본문 글꼴 체인은 모든 렌더러에서 Eulyoo1945를 우선하고, Eulyoo에 없는 글리프
(예: `잓`)는 같은 굵기의 Noto Serif KR로 폴백한다. 네이티브 WebView는 앱에
등록된 글꼴을 직접 볼 수 없으므로 Eulyoo와 Noto Serif KR WOFF2를 데이터 URI로
각각 주입한다. Noto 자원은 기본 라틴·문장부호·한글 자모와 현대 한글 전체
(`AC00–D7A3`, `잓` 포함)를 보존한 OFL 서브셋이다. 작성·읽기·측정은 네 글꼴의 디코딩이 끝난 뒤 시작하며, 디코딩
실패나 제한 시간 초과 때만 동일한 시스템 serif 폴백으로 진행한다.

아래의 기준 CSS는 `buildBodyTypographyCss()`다. 네이티브 리더는
`spaced`/`hrStyle: "spaced"`/밑줄 offset을, 측정 레이어는
`zero`/`hrStyle: "measure"`를 선택한다. 작성 에디터는 TipTap DOM과 HR 조작 UI
때문에 자체 템플릿을 쓰지만, 본문 메트릭과 제목 크기는 같은 레이아웃 계산값을
받아야 한다.

| Markdown / DOM 블록 | 정렬·폰트·행간·자간 | 여백·장식 | 줄바꿈 / 구현 범위 |
| --- | --- | --- | --- |
| 문단 (`p`) | 양쪽 맞춤, Eulyoo Regular, 본문 1.8, 본문 자간 | 화면용 `margin-bottom: 1em`; 측정용 0 | `overflow-wrap`/`word-wrap: break-word`, `word-break: normal`, 자동 hyphenation, `text-justify: inter-ideograph` |
| H1 | 왼쪽, Eulyoo SemiBold 600, `1.6em`, 행간 1.25, `0.025em` | `1em 0 0.4em`; 측정용 0 | 제목은 양쪽 맞춤하지 않는다. 제목 입력은 `-0.01em`, 아래 1 px border, `8px 0` padding, 12 px 아래 여백을 별도로 가진다. |
| H2 | 왼쪽, SemiBold 600, `1.3em`, 행간 1.3, `0.025em` | `0.8em 0 0.3em`; 측정용 0 | 제목 정책을 따른다. |
| H3 | 왼쪽, SemiBold 600, `1.1em`, 행간 1.35, `0.025em` | `0.6em 0 0.3em`; 측정용 0 | 제목 정책을 따른다. |
| 인용 (`blockquote`) | 화면/측정 기준은 양쪽 맞춤, Eulyoo Regular italic, `#52525b` | 왼쪽 3 px `#d4d4d8` 선, 왼쪽 1em padding, 화면용 `0.5em 0`; 측정용 0 | 문단과 같은 break/hyphenation 규칙. 네이티브 활성 에디터와 웹 에디터는 현재 입력 중 인용을 왼쪽 맞춤으로 표시한다. |
| 목록 (`ul`, `ol`, `li`) | 목록과 항목 모두 왼쪽 맞춤; 항목의 본문 메트릭을 상속 | 목록 `padding-left: 1.5em`, 화면용 아래 1em; 항목 아래 0.2em; `li p` 아래 여백 0 | 목록의 줄바꿈은 목록 안에서 일어나며 일반 문단의 양쪽 맞춤 정책을 적용하지 않는다. |
| 구분선 (`hr`) | 텍스트 정렬·행간·자간 없음 | `border-top: 1px solid #e4e4e7`; 리더 `1em 0`, 측정은 높이 1 px/여백 0 | 에디터는 HR 자체 여백 0, `.hr-wrapper`가 1em 여백과 조작 영역을 담당한다. |
| 밑줄 (`u`) | 부모 텍스트의 메트릭·정렬을 상속 | 리더 네이티브만 `text-underline-offset: 0.2em` | Web reader와 편집기는 현재 기본 underline offset을 사용한다. |
| 굵게 / 기울임 (`strong`, `em`) | `strong`: Eulyoo SemiBold 600 → Noto Serif KR SemiBold 600; `em`: italic | 별도 블록 여백 없음 | 부모 문단/제목의 줄바꿈을 상속한다. |
| 인라인 이미지 (`img[data-inline]`) | 텍스트 정렬 대상이 아닌 block | native shared CSS: `max-width:240px`, auto 크기, 8 px radius, `0.5em 0` | 한 줄 전체 이미지 Markdown만 reader 변환기가 이미지로 만든다. Web reader는 현재 이 명시 CSS를 갖지 않으므로 변경 시 native/web을 모두 확인한다. |
| 코드 (`code`, `pre`) | **리더·측정용 Markdown 변환기의 지원 블록이 아니다.** | reader/measure 공통 CSS에 전용 `code`/`pre` 스타일 없음 | fenced code는 reader 변환기에서 코드 블록으로 보장되지 않는다. Web 에디터만 현재 `ui-monospace`, 회색 배경, `pre` 가로 스크롤을 별도로 제공한다. 교차 흐름용 코드 서식을 새로 지원할 때는 파서, 에디터, 리더, 측정기의 정책을 함께 설계한다. |

`markdownRenderer.ts`는 리더와 측정 레이어가 신뢰하는 Markdown→HTML 변환기다.
이 변환기와 작성 WebView의 변환/내보내기 결과를 바꾸면, 위 CSS만 맞춰서는 페이지
분할이 일치하지 않는다. 특히 지원하지 않는 블록을 “브라우저 기본 스타일에
맡기는” 방식으로 추가하지 않는다.

---

## 5. 변경 순서와 검증 방법

### 수동 플랫폼 검증 (본문 정렬 변경 시)

작성/분할, 마감 미리보기, 읽기를 iOS·Android·Web에서 같은 한국어 probe
(`가잓`과 긴 문단/제목 포함)로 확인한다. iOS/Android에서는 시스템 글자 크기와
디스플레이 크기를 각각 바꾼 뒤에도 줄바꿈이 유지되는지 확인하고, Web에서는 브라우저
기본 글꼴 크기를 바꾼 뒤 확인한다. 네이티브 WebView의 `textZoom={100}` 및 CSS의
`text-size-adjust:100%`가 이 경로를 고정한다. 개발 빌드에서는 renderer 진단 로그의
DOM 폭, font-size, line-height, letter-spacing, text-size-adjust, DPR, text zoom과
Eulyoo regular/semibold 로드 상태를 비교한다. reader/editor/measure의 값이 같은
본문 계약 값이어야 하며, 다르면 해당 renderer를 표시하기 전에 수정한다.

작성 편집기의 실제 DOM은 네이티브와 Web 모두 공통 `textColumnWidth` 자체가
입력 폭이다. 화면 쪽 래퍼가 이미 이 폭으로 제한되므로 `.ProseMirror`나 제목
입력에 가로 padding을 다시 넣지 않는다. 세로 시작 여백과 키보드 아래 스크롤
여유만 편집기 구조 CSS로 둔다. 문단·제목·목록·인용·구분선·강조의 폰트와
줄바꿈 규칙은 `buildBodyTypographyCss()`를 통해 편집기/측정/리더가 공유한다.

회전, 웹 창 크기 변경, Android 키보드로 인한 usable window 변경 뒤에는 다음을
한 세트로 확인한다.

1. `useEditorLayout()`이 새 화면 크기로 `textColumnWidth`와 본문 메트릭을 만든다.
2. 활성 편집 DOM이 `setBodyMetrics` 또는 React style 갱신으로 같은 폭을 받는다.
3. 경고/분할 측정 요청도 새 `typography` 객체로 다시 발급된다.
4. 측정 응답은 자신을 만든 요청과 함께 소비되며 이전 요청의 높이/페이지 경계는
   현재 화면에 재사용되지 않는다.

네이티브에서는 편집기·리더·측정 WebView가 각각 폰트를 디코드하지만 최종
`custom`/`fallback` 선택은 RN 세션 상태 하나를 공유한다. 어느 한 문서라도
실패하거나 제한 시간에 도달하면 fallback이 세션 동안 고정되어 모든 활성
WebView에 전파되고, 측정 요청의 `fontMode`도 바뀌어 이전 custom-font 결과가
현재 경계로 채택되지 않는다. fallback에서 custom으로 자동 복귀시키지 않는다.

고정 회귀 문구에는 `가잓`, 긴 한국어 문단, 공백 없는 긴 문자열, H1/H2/H3,
순서/비순서 목록, 인용, HR, 굵게/기울임/밑줄을 포함한다. 키보드 표시 전후와
회전 전후에 편집기 진단의 `domWidthPx`가 측정 진단과 같은
`textColumnWidth`인지 먼저 비교한 뒤 페이지 경계를 확인한다.

### 공통 값을 바꿀 때

1. 값을 둘 곳을 먼저 고른다. UI 토큰은 `Typography`, 본문 척도·컬럼은
   `ReaderTokens`/`bodyLayout`, 공통 블록 정책은 `bodyTypographyCss`가 기준이다.
2. `containerWidth`가 같은 상태에서 `textColumnWidth`, 본문 크기, 행간, 자간,
   제목 크기가 작성·측정·마감·읽기에 모두 동일하게 전달되는지 확인한다.
3. 문단, 긴 공백 없는 문자열, H1/H2/H3, 인용, 순서/비순서 목록, HR, 밑줄,
   이미지가 섞인 긴 글로 다음 흐름을 순서대로 확인한다.
   - 작성에서 줄바꿈·overflow 위치 확인
   - 분할 후 페이지 경계와 측정 높이 확인
   - 마감 미리보기의 축소 카드 확인
   - 읽기 카드의 같은 페이지·줄바꿈 확인
4. iOS/Android 네이티브 WebView와 Expo Web을 모두 확인한다. Web renderer는
   별도 구현이므로 “웹에서만 맞음”은 본문 변경의 완료 기준이 아니다.
5. 일반 UI 텍스트도 바꿨다면 아래 명령과 최소 가독성 체크리스트를 적용한다.

```bash
pnpm --filter @workspace/friction check:typography
```

### 새 화면 또는 새 본문 렌더러 체크리스트

- [ ] 일반 UI에는 `Typography.*`를 사용했고
  [`typography-rules.md`](./typography-rules.md)의 최소선과 예외 규칙을 확인했다.
- [ ] 페이지 분량·줄바꿈에 참여하는 본문은 `computeBodyLayout()`의 같은
  `containerWidth`와 정수 `textColumnWidth`를 사용한다.
- [ ] 본문 WebView에는 `bodyFontSize`, `bodyLetterSpacing`, H1용
  `titleFontSize`를 함께 전달한다.
- [ ] 문단의 양쪽 맞춤/줄바꿈 정책과 목록·제목의 왼쪽 맞춤을 의도적으로 구분했다.
- [ ] 측정 전용 렌더러에는 화면용 block margin을 중복 적용하지 않았다.
- [ ] 새 Markdown 블록은 작성 변환, reader 변환, 측정 변환, native/Web CSS에
  모두 정의했거나 지원하지 않음을 명시했다.
- [ ] 물리 safe-area, NavBar, 키보드 회피가 문제라면 이 문서의 가상 본문 박스를
  수정하지 않고 안전 영역 계산 기준 문서를 따라 별도로 검토했다.

이 문서는 현재 값을 설명하는 문서다. 설정을 리팩터링하거나 수치를 바꾸는 작업은
별도 변경으로 진행하고, 이 문서와 실제 렌더러를 같은 변경에서 다시 대조한다.