# Friction 안전 영역·본문 레이아웃 계산 기준

이 문서는 작성 단계, 상세 읽기, 기록함을 수정할 때 **화면 안전 영역**, **고정 NavBar 회피 여백**, **리더 논리 페이지 프레임**을 서로 다른 값으로 다루기 위한 유지보수 기준이다.

목표는 현재 레이아웃을 바꾸는 것이 아니라, 같은 값을 두 번 더하거나 서로 다른 기준으로 본문을 재측정하여 생기는 다음 문제를 예방하는 것이다.

- 홈 인디케이터·상태바와 콘텐츠 또는 플로팅 버튼이 겹침
- 웹에서 `useSafeAreaInsets()`가 0인 사실을 놓쳐 헤더·하단 바가 브라우저 가장자리에 붙음
- NavBar 위 목록이 마지막 항목에서 가려짐
- 작성/분할/마감/읽기에서 본문 폭 또는 높이가 달라져 줄바꿈·페이지 분량이 달라짐

현재 코드의 출처와 식을 기록한 문서다. 토큰이나 레이아웃 동작의 변경 제안은 이 문서의 범위가 아니다.

---

## 1. 먼저 구분할 용어

| 용어 | 의미 | 값의 출처 | 영향을 주는 UI | 다른 값과 섞으면 안 되는 이유 |
| --- | --- | --- | --- | --- |
| **물리 화면 inset** | 노치·상태바·홈 인디케이터처럼 실제 기기 가장자리에서 피해야 하는 영역 | `useSafeAreaInsets()`의 `insets.top`, `insets.bottom` | 전체 화면 헤더, 플로팅 버튼, 고정 하단 액션 | 기기와 회전에 따라 달라진다. 리더 본문 분량의 기준이 아니다. |
| **웹 fallback inset** | 웹에서 native inset이 0인 것을 보완하는 프로젝트 기준값 | `Platform.OS === "web"`일 때 상단 `67`, 하단 `34` | 새 화면·절대 위치 요소의 화면 가장자리 여백 | `useSafeAreaInsets()`가 대신해 주지 않는다. 현재 기존 화면 중 일부는 아직 직접 적용하지 않으므로, 수정 시 의도적으로 현행값을 유지할지 확인한다. |
| **NavBar 위치값** | 화면 하단에서 floating NavBar 자체까지의 거리 | `Spacing.navBarBottom + insets.bottom` | `NavBar` 컨테이너의 `bottom` | 콘텐츠가 NavBar 위로 올라가야 하는 거리와는 다르다. |
| **NavBar clearance** | 스크롤 콘텐츠·CTA·FAB가 NavBar와 그 위 간격을 모두 피하는 하단 padding | `useNavBarBottomSafeArea(extraGap)` | 탭 화면 목록, 빈 상태, NavBar 위 CTA/FAB | NavBar의 높이와 콘텐츠-NavBar 사이 여유를 포함한다. NavBar 위치값만 사용하면 가려진다. |
| **논리 페이지 프레임** | 5:8 비율의 종이 한 장. 화면 안에 그대로 표시하거나 축소해 프레임에 넣는 기준 | `BodyLayout.pageWidth`, `pageHeight` | 작성·분할·마감·읽기의 본문 글꼴 및 페이지 지오메트리 | 물리 화면의 safe area가 아니라 페이지/책의 설계 크기다. |
| **본문 열** | Yoga 픽셀 스냅까지 고정한 실제 텍스트 폭 | `textColumnWidth` | 에디터, Pretext 측정, 읽기 WebView | 이 값을 다시 padding으로 추정하면 1px 차이로 줄바꿈과 페이지 결과가 달라질 수 있다. |

### 책임 경계

1. **화면 가장자리 회피**는 화면/오버레이가 물리 inset 또는 웹 fallback으로 담당한다.
2. **NavBar 회피**는 NavBar를 함께 쓰는 콘텐츠가 clearance 하나로 담당한다.
3. **리더 본문 분량**은 `lib/bodyLayout.ts`만 담당한다. 기기 inset이나 NavBar clearance를 이 계산에 넣지 않는다.
4. 카드가 시트·키보드로 축소되는 경우에는 카드 프레임 배치만 바꾸고, 컨테이너 폭과 본문 메트릭은 유지한다.

---

## 2. 공통 값과 기준식

### 2.1 물리 inset과 웹 fallback

`useSafeAreaInsets()`는 native iOS/Android의 실제 inset을 제공한다. Expo Web에서는 해당 값이 0이므로, 프로젝트 전용 규칙은 다음과 같다.

| 플랫폼 | 상단 기준 | 하단 기준 | 근거 |
| --- | --- | --- | --- |
| iOS / Android | `insets.top` | `insets.bottom` | 실제 기기 안전 영역 |
| Web | `67px` | `34px` | `.agents/skills/expo-web-compat/SKILL.md`의 프로젝트 규칙 |

새 화면에서 화면 끝과 직접 맞닿는 콘텐츠는 다음처럼 플랫폼별 기준을 **한 번만** 선택한다.

```ts
const topInset = Platform.OS === "web" ? 67 : insets.top;
const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;
```

기존 화면의 현재 동작을 고칠 목적이 아니라면, 단순히 위 fallback을 추가해 레이아웃을 바꾸지 않는다. 이 문서는 현행 계산을 설명하며, 화면별 fallback 통일은 별도 작업으로 다룬다.

### 2.2 Floating NavBar와 clearance

공통 NavBar의 위치와 콘텐츠 회피 거리는 의도적으로 다르다.

| 항목 | 식 | 현재 값의 구성 | 코드 |
| --- | --- | --- | --- |
| NavBar의 화면 하단 위치 | `insets.bottom + Spacing.navBarBottom` | device bottom + `36` | `components/NavBar/NavBar.tsx` |
| NavBar clearance 기본값 | `insets.bottom + Spacing.navBarBottom + Sizing.navBarHeight + extraGap` | device bottom + `36` + `60` + 기본 `20` = `insets.bottom + 116` | `hooks/useNavBarBottomSafeArea.ts` |
| 과거 고정 토큰 | `Spacing.navBarPaddingBottom` | `116` | `constants/tokens.ts` |

`useNavBarBottomSafeArea()`는 기본 `extraGap`까지 포함하므로, NavBar가 있는 목록의 `paddingBottom`에는 이 훅 **하나만** 사용한다. 그 결과 마지막 항목은 NavBar 상단에서 기본 20px 떨어진 위치까지 스크롤될 수 있다.

```ts
const navBottom = useNavBarBottomSafeArea();
// contentContainerStyle={{ paddingBottom: navBottom }}
```

Web에서는 이 훅의 `insets.bottom`이 현재 0이므로 결과가 `108px`이다. 이는 웹 fallback 하단 `34px`을 자동 포함한다는 뜻이 아니다. 웹 화면을 새로 만들거나 absolute UI를 추가할 때는 사용 목적에 따라 NavBar clearance와 웹 fallback을 분리해 검토한다.

### 2.3 리더/에디터의 논리 페이지 프레임

`ReaderTokens`와 `computeBodyLayout(pageWidth)`는 작성(`on-01a`), 분할(`on-01b`), 마감(`on-01c`), 읽기가 같은 줄바꿈 기준을 쓰게 하는 단일 진입점이다.

`cqiToPx(cqi, C) = cqi / 100 × C`라 할 때, `C = pageWidth`이다.

| 값 | 토큰 | 식 | 용도 |
| --- | --- | --- | --- |
| `pageWidth` | 논리 페이지 폭 | `C` | 페이지 프레임 전체 폭 |
| `pageHeight` | `aspectRatio = 5/8` | `C / (5/8)` | 페이지 프레임 전체 높이 |
| `paddingX` | `padding.xCqi = 6` | `0.06 × C` | 페이지 프레임 안 좌우 패딩 |
| `paddingY` | `padding.yCqi = 15` | `0.15 × C` | 페이지 프레임 안 상하 안전 여백 |
| `textColumnWidth` | 위 세 값 | `round(C - 2 × 0.06C)` = `round(0.88 × C)` | 실제 WebView/측정 텍스트 열 폭 |
| 본문 글자 크기 | `typeScale.bodyCqi = 4.0` | `0.04 × C` | 에디터·리더 WebView |
| 본문 줄높이 | `lineHeight.relaxed = 1.8` | `bodyFontSize × 1.8` | 에디터·리더 WebView |
| 본문 자간 | `letterSpacing.relaxedEm = 0.05` | `bodyFontSize × 0.05` | 에디터·리더 WebView |
| 제목 글자 크기 | `typeScale.titleCqi = 6.4` | `0.064 × C` | 에디터·리더 WebView |

`textColumnWidth`는 의도적으로 반올림된 정수다. 자식의 `width`에 이 값을 직접 전달해야 부모 위치에 따른 Yoga의 ±1px 스냅 차이를 막고, 작성과 읽기의 페이지 분량을 일치시킬 수 있다.

### 2.4 리더 카드 프레임

`ReaderTokens.aspectRatio = 5 / 8`이다. 읽기 화면의 카드 프레임 계산은 다음과 같다.

| 값 | 식 | 설명 |
| --- | --- | --- |
| 폭 기준 최대 높이 | `heightFromWidth = availableWidth / (5/8)` | 가용 폭으로 만들 수 있는 카드 높이 |
| 높이 기준 최대 폭 | `widthFromHeight = availableHeight × (5/8)` | 가용 높이로 만들 수 있는 카드 폭 |
| 논리 컨테이너 폭 | stored `layoutWidth`가 있으면 그 값, 아니면 `min(widthFromHeight, screenWidth)` | 저장 당시 줄바꿈 기준을 우선 보존 |
| 논리 컨테이너 높이 | `containerWidth / (5/8)` | 페이지의 설계 높이 |
| 표시 프레임 폭/높이 | 논리 컨테이너에 `scaleFactor = min(availableWidth/containerWidth, availableHeight/containerHeight, 1)` 적용 | 작은 가용 영역에도 본문 메트릭을 바꾸지 않고 카드만 축소 |

읽기 카드의 실제 `availableWidth`에는 좌우 그림자 여백 `READER_SIDE_PAD × 2`가 빠진다. `pageListContainer`도 좌우 `14px` padding을 사용해야 그림자가 잘리지 않는다.

---

## 3. 화면별 현재 계산

### 3.1 작성·분할 — `app/on-01a.tsx`

화면 루트는 현재 `paddingTop: insets.top`을 적용한다. 헤더와 분할 도구는 그 아래에 일반 흐름으로 쌓이고, 남은 높이를 `KeyboardAvoidingView`의 `flex: 1` 에디터가 사용한다. 이 화면은 현행 코드상 웹 `67px` fallback을 별도로 적용하지 않는다.

| 영역 | 값의 출처 / 식 | 목적 | 수정 시 주의 |
| --- | --- | --- | --- |
| 화면 상단 | `insets.top` | 상태바·노치 아래에서 작성 헤더 시작 | 웹에서는 0이다. 기존 동작을 바꾸지 않는 문서 작업과 별개로 fallback을 임의 추가하지 않는다. |
| 작성 헤더 | 좌우 `Spacing.screenPx = 24`, 상하 `12` | 뒤로가기·단계 바 배치 | 헤더 높이를 본문 분할 높이에 직접 빼지 않는다. 분할은 가상 페이지 기준이다. |
| 분할 툴바 | 좌우 `24`, 상하 `8` | 페이지 수/맞춤법/자동분할 도구 | 에디터의 남는 실제 화면 공간을 줄이지만, 페이지 분량 식을 바꾸지 않는다. |
| 페이지 칩 영역 | 고정 높이 `44` | 분할 상태의 페이지 칩 | 화면 chrome이며 논리 페이지 프레임과 별도다. |
| 에디터 바깥 폭 | `pageWidth = C` | 논리 페이지 프레임 폭 | `C`는 `useEditorLayout()`의 `min(screenHeight × 5/8, screenWidth)`이다. |
| 에디터 실제 본문 열 | `textColumnWidth = round(C - 2 × paddingX)` | WebView 줄바꿈 기준 | `paddingHorizontal`만으로 대체하지 말고 명시 폭을 그대로 전달한다. |
| 분할용 페이지 전체 높이 | `pageContentHeight = pageHeight = C / (5/8)` | 경고·자동분할이 비교하는 페이지 프레임 높이 | 물리 화면의 높이, 헤더, NavBar 높이를 합산하지 않는다. |
| 분할용 본문 가용 높이 | `pageHeight - 2 × paddingY - insets.bottom - titleBarHeight` | 블록이 들어갈 수 있는 높이 | 새 페이지는 리더·내보내기와 같은 하단 예약을 미리 반영한다. |
| 측정된 페이지 총높이 | `sum(blockHeights) + 2 × paddingY + insets.bottom + titleBarHeight` | 페이지 프레임 한계와 비교·경고 | 위 가용 높이와 같은 항을 반대 방향으로 사용해 총 콘텐츠 높이를 복원한다. |
| 키보드 중 툴바 회피 | 네이티브에서만 `toolbarSpacerBottom = 60` | floating 서식 툴바에 에디터 끝이 가려지지 않게 함 | 페이지 분할 식에 포함하지 않는다. 웹 서식 툴바는 이 경로를 사용하지 않는다. |

분할 측정 요청에는 폭(`pageWidth`, `paddingX`, `textColumnWidth`)과 글꼴 메트릭(`bodyFontSize`, `lineHeight`, `letterSpacing`, `titleFontSize`)을 모두 전달한다. 분할 엔진을 고칠 때 이 중 일부만 바꾸면 보이는 WebView와 측정 결과가 달라진다.

**대표 진입점**

- `lib/useEditorLayout.ts` — 화면 치수에서 리더 컨테이너 폭을 결정
- `lib/bodyLayout.ts` — 논리 페이지 프레임과 글꼴 메트릭의 단일 계산
- `app/on-01a.tsx` — 분할 높이·WebView·키보드/툴바 회피 적용

### 3.2 상세 읽기 — `app/read.tsx`

읽기 화면은 전체 화면에서 카드의 가용 프레임을 실측하고, 본문은 저장된 `layoutWidth`(없으면 작성 단계와 같은 fallback 폭)로 계산한다. 즉 **표시 카드가 축소돼도 본문 폭·글자 크기·줄바꿈 기준은 저장/작성 기준으로 유지**된다.

| 영역 | 값의 출처 / 식 | 목적 | 수정 시 주의 |
| --- | --- | --- | --- |
| 카드 가용 폭 | `(pageListSize.width 또는 screenWidth) - 2 × READER_SIDE_PAD` | 카드 양옆 그림자 노출 | `READER_SIDE_PAD = 14`와 컨테이너 좌우 padding `14`는 함께 유지한다. |
| 카드 가용 높이 | `pageListSize.height` (측정 전에는 폭 기준 fallback) | 5:8 카드 프레임 fit | 카드의 표시 크기만 결정한다. |
| 본문 기준 폭 | `article.layoutWidth`가 있으면 사용, 없으면 `min(screenHeight × 5/8, screenWidth)` | 작성 당시 줄바꿈·글꼴 메트릭 보존 | 가용 프레임 폭으로 본문 메트릭을 재계산하지 않는다. |
| 카드 논리 크기 | `containerWidth × (containerWidth / 5/8)` | 페이지 슬롯의 설계 크기 | 카드 프레임과 혼동하지 않는다. |
| 카드 표시 크기 | 논리 크기에 `scaleFactor` 적용 | 화면·시트의 가용 영역에 맞춤 | 축소는 outer frame만 담당한다. |
| 페이지 프레임 | `pageWidth = W`, `pageHeight = W / (5/8)` | 페이지 안의 본문 블록 폭·높이 | 물리 화면 safe inset이 아니다. |
| 본문 좌우/상단 패딩 | `paddingX`, `paddingY` | 카드 내부 여백 | `textColumnWidth`와 함께 `computeBodyLayout()` 결과를 쓴다. |
| 본문 하단 패딩 | `insets.bottom + paddingY + titleBarHeight` | 홈 인디케이터·카드 하단 제목 오버레이 회피 | 이 `insets.bottom`은 물리 안전 영역이고, 카드 내부 title bar 보호를 추가한다. |
| 제목 바 높이 | `round(20 + captionFontSize × 1.3)` | 페이지 하단 제목 오버레이 예약 | 본문 양을 바꾸므로 임의 높이 변경 시 작성/분할과 영향 범위를 확인한다. |
| 상단 뒤로가기 버튼 | `top: insets.top + 12` | 상태바와 플로팅 버튼 충돌 방지 | absolute 요소이므로 화면 inset을 별도로 더한다. |
| 메모 FAB | `bottom: insets.bottom + 24`, `right: 20` | 홈 인디케이터 위에 고정 | NavBar를 피하는 화면이 아니므로 NavBar clearance를 쓰지 않는다. |
| 문장 선택 pill | `bottom: insets.bottom + 80 + max(0, (pageListSize.height - frameHeight)/2)` | 홈 인디케이터와 카드 아래 빈 공간을 함께 피함 | `80`은 pill/card 간 시각 여유이며 NavBar 높이가 아니다. 카드 프레임 차이를 빼지 말고 더한다. |
| 단상 시트가 열린 카드 상단 | `insets.top + 8` | 시트 위 가용 영역의 상단 | 카드 축소·이동 계산만 바꾸며 본문 컨테이너 폭은 유지한다. |
| 완독 화면 하단 액션 | `paddingBottom: max(insets.bottom, 24)` | 홈 인디케이터가 있어도 최소 24px 유지 | 전체 화면 완료 슬롯의 액션 규칙이며 카드 본문 규칙과 별개다. |

#### 리더 WebView의 역할

`components/WebViewMarkdownReader/WebViewMarkdownReader.tsx`(native)와 `WebViewMarkdownReaderWeb.tsx`(web)는 부모가 준 `bodyFontSize`, `bodyLetterSpacing`, `titleFontSize`를 렌더링에 사용한다. 이 컴포넌트는 화면 inset이나 NavBar clearance를 계산하지 않는다.

웹 구현은 `width: 100%`, `height: 100%`인 wrapper 안에서 부모가 정한 `textColumnWidth`를 그대로 채운다. 따라서 WebView 컴포넌트 내부에서 별도의 화면 padding 또는 fallback inset을 추가하면 작성/읽기 줄바꿈 불일치가 생긴다.

### 3.3 기록함 — `app/(tabs)/archive.tsx`

기록함은 reader처럼 고정 비율 카드를 만들지 않는다. 대신 일반 상태의 목록/빈 상태는 floating NavBar를 피하고, 문장 선택 상태에서는 NavBar가 아닌 **선택 삭제 바**를 피하도록 별도 계산을 사용한다.

| 상태·영역 | 식 | 목적 | 왜 다른가 |
| --- | --- | --- | --- |
| 일반 화면 헤더 | `PageHeader`: native `insets.top + Spacing.headerPt`; web `67 + Spacing.headerPt` | 보관 헤더를 화면 상단에서 안전하게 시작 | `PageHeader`가 웹 fallback을 직접 담당한다. |
| 일반 목록·그리드 하단 | `navBottom = insets.bottom + 36 + 60 + 20` | 마지막 폴더/문장을 floating NavBar보다 위로 스크롤 | NavBar가 실제로 노출된 상태이므로 전체 clearance가 필요하다. |
| 일반 빈 상태 하단 | `paddingBottom: navBottom` | 중앙 정렬 콘텐츠가 NavBar에 의해 시각적으로 눌리지 않음 | 목록과 같은 NavBar 회피 책임이다. |
| 문장 선택 화면 루트 상단 | `paddingTop: insets.top` | 선택 헤더가 native 상태바와 겹치지 않음 | 선택 모드에서는 `PageHeader` 대신 별도 헤더를 쓴다. |
| 문장 선택 헤더 내부 | `paddingTop: 50`, `paddingBottom: 20` | 취소/선택 개수 헤더의 고정 시각 여백 | 현재는 `PageHeader`와 다른 컴포넌트다. 웹에서는 root inset이 0이므로 이 50px이 현행 상단 여백이다. |
| 문장 선택 바 위치 | `bottom: 0`, `paddingBottom: insets.bottom + 36 + 60 + 12` | 삭제 버튼이 홈 인디케이터와 NavBar가 있던 시각 영역 위에 보이도록 함 | 선택 모드에서는 NavBar 대신 삭제 바가 하단 chrome이다. `12`는 선택 바 내부 여유다. |
| 문장 선택 목록 하단 | `insets.bottom + 36 + 60 + 80` | 마지막 문장이 선택 바/하단 chrome 뒤에 숨지 않음 | `80`은 선택 삭제 바의 버튼·상단 padding을 고려한 목록 reserve다. 버튼 바의 padding만으로는 목록 끝을 보장할 수 없다. |

일반 모드의 `navBottom`과 선택 모드 식은 비슷해 보여도 교체 가능한 값이 아니다.

- **일반 모드**: NavBar는 화면 위에 떠 있고 목록은 그 전체 높이와 위 간격을 피해 스크롤한다.
- **선택 모드**: 화면 하단에 absolute 선택 바가 렌더링되며, 목록은 실제 버튼 바의 높이까지 추가로 피해야 한다. 이때 `80`은 현재 선택 바의 시각적 reserve이고, `extraGap`과 같은 뜻이 아니다.
- **선택 바 자체**: 하단 `paddingBottom`은 버튼의 터치 영역을 안전한 위치에 올리는 값이다. 목록 padding을 이 값으로 대체하면 마지막 항목이 선택 바 아래로 들어갈 수 있다.

**대표 진입점**

- `components/NavBar/PageHeader.tsx` — 상단 inset 및 웹 `67px` fallback
- `components/NavBar/NavBar.tsx` — floating NavBar의 실제 위치
- `hooks/useNavBarBottomSafeArea.ts` — 일반 목록/CTA의 공통 clearance
- `app/(tabs)/archive.tsx` — 일반·선택 모드의 목록 reserve와 선택 바

---

## 4. 플랫폼별 적용 규칙

### iOS / Android

- `useSafeAreaInsets()` 결과를 화면 가장자리와 연결된 UI에 사용한다.
- iOS 노치/홈 인디케이터가 없는 기기에서는 0일 수 있으므로, 디자인상 필요한 최소 간격은 별도 상수(`+ 12`, `+ 24` 등)로 표현한다.
- 키보드 회피는 safe inset과 다른 문제다. 작성 화면은 `KeyboardAvoidingView`에서 iOS `padding`, Android `height`를 사용하며, 서식 툴바를 피하는 60px도 별도의 키보드 레이아웃 값이다.

### Web

- `useSafeAreaInsets()`는 0이므로 새 화면·absolute UI가 화면 가장자리를 직접 사용할 때 상단 `67px`, 하단 `34px` fallback을 적용한다.
- `PageHeader`는 이미 상단 `67px` fallback을 가진다. 같은 헤더 바깥 컨테이너에 다시 67px을 더하지 않는다.
- current NavBar clearance 훅은 웹 fallback `34px`을 포함하지 않는다. 웹에서 NavBar와 콘텐츠가 함께 보이는 새 UI는 NavBar clearance의 목적과 웹 fallback 필요 여부를 따로 판단한다.
- 리더 WebView는 웹에서도 부모 카드의 명시 텍스트 열을 따라야 한다. 브라우저 viewport inset을 `BodyLayout` 식에 넣지 않는다.

---

## 5. 새 UI를 만들 때의 선택 기준

### 먼저 이 질문에 답한다

| 만들려는 UI | 사용할 기준 | 사용하지 말 것 |
| --- | --- | --- |
| 화면 상단의 일반 헤더 | `insets.top` 또는 웹 `67`; 기존 목록 헤더면 `PageHeader` | 리더 `pageHeight` |
| 화면 하단에 고정되는 CTA/FAB | `insets.bottom` 또는 웹 `34` + 디자인 간격 | NavBar clearance (NavBar와 실제로 경쟁하지 않는 경우) |
| NavBar가 있는 탭의 스크롤 목록/빈 상태 | `useNavBarBottomSafeArea()` | `Spacing.navBarPaddingBottom`과 inset을 다시 더하는 식 |
| NavBar 위에 별도 absolute 바가 생기는 선택 모드 | 바의 실제 높이·내부 bottom padding을 반영한 목록 reserve | 일반 모드의 `navBottom`만 재사용 |
| 리더/에디터의 본문·측정·페이지 분할 | `useEditorLayout()` 또는 `computeBodyLayout()` 반환값 | `useSafeAreaInsets()`나 화면 폭으로 자체 재계산 |
| 리더 카드가 시트/작은 창에 맞춰야 함 | 프레임 `scaleFactor`/배치만 조정 | 저장된 `layoutWidth`로 정한 본문 폭·글꼴 재계산 |
| reader 내부 WebView | 전달받은 `textColumnWidth`와 본문 메트릭 | WebView 내부의 독자적인 화면 padding/inset |

### 피해야 할 중복 계산

```ts
// 나쁨: navBottom이 이미 insets.bottom을 포함한다.
paddingBottom: useNavBarBottomSafeArea() + insets.bottom

// 나쁨: PageHeader는 web 67px fallback을 이미 처리한다.
<View style={{ paddingTop: Platform.OS === "web" ? 67 : insets.top }}>
  <PageHeader title="..." />
</View>

// 나쁨: 논리 페이지 높이에 실제 기기 전체 높이를 추가한다.
const pageHeight = layout.pageHeight + screenHeight;

// 나쁨: textColumnWidth를 패딩만으로 재현해 부모별 반올림 차이를 만든다.
<View style={{ width: layout.pageWidth, paddingHorizontal: layout.paddingX }} />
```

```ts
// 좋음: NavBar와 겹치는 목록은 한 clearance를 단일 출처로 사용한다.
const navBottom = useNavBarBottomSafeArea();
<FlatList contentContainerStyle={{ paddingBottom: navBottom }} />

// 좋음: 본문은 공통 계산 결과의 정수 열 폭을 그대로 쓴다.
const layout = useEditorLayout();
<View style={{ width: layout.textColumnWidth }} />
```

---

## 6. 수정 전 체크리스트

### 화면·오버레이

- [ ] 이 값은 물리 화면 inset, 웹 fallback, NavBar clearance, 논리 페이지 프레임 중 무엇인가?
- [ ] absolute `top`/`bottom` 요소라면 native inset과 웹 fallback을 각각 검토했는가?
- [ ] 기존 `PageHeader` 또는 `NavBar`가 이미 처리하는 inset을 부모에서 한 번 더 더하지 않았는가?
- [ ] iOS/Android와 Web에서 `useSafeAreaInsets()`의 값이 다르다는 점을 반영했는가?

### NavBar·목록·하단 액션

- [ ] 일반 탭 목록/빈 상태는 `useNavBarBottomSafeArea()` 하나로 NavBar를 피하는가?
- [ ] 선택 모드처럼 별도 bottom bar가 있으면, 목록 reserve와 바 자체의 bottom padding을 각각 계산했는가?
- [ ] `Spacing.navBarPaddingBottom`을 새 코드의 주 계산값으로 쓰지 않고 동적 훅을 우선했는가?
- [ ] web에서 clearance가 `34px` fallback을 자동 포함한다고 가정하지 않았는가?

### 작성·리더·페이지 분할

- [ ] `computeBodyLayout()` 또는 `useEditorLayout()`을 통해 본문 메트릭을 얻었는가?
- [ ] `pageWidth/pageHeight`가 기기 inset이 아니라 리더의 논리 페이지 지오메트리임을 구분했는가?
- [ ] `textColumnWidth`를 정수 폭으로 직접 사용했는가?
- [ ] 작성/분할/마감/읽기의 줄바꿈·분량에 영향을 주는 값을 한 화면에서만 바꾸지 않았는가?
- [ ] 카드 축소 요구가 있다면 본문 폭 재계산 대신 프레임 scale/배치를 검토했는가?

### 확인할 대표 파일

| 목적 | 파일 |
| --- | --- |
| 토큰과 리더 비율·cqi 정의 | `artifacts/friction/constants/tokens.ts` |
| 논리 페이지 프레임·본문 열 단일 계산 | `artifacts/friction/lib/bodyLayout.ts` |
| 작성/분할 공통 컨테이너 폭 | `artifacts/friction/lib/useEditorLayout.ts` |
| NavBar 위 콘텐츠 clearance | `artifacts/friction/hooks/useNavBarBottomSafeArea.ts` |
| Floating NavBar 실제 위치 | `artifacts/friction/components/NavBar/NavBar.tsx` |
| 일반 페이지 헤더의 web fallback | `artifacts/friction/components/NavBar/PageHeader.tsx` |
| 작성·분할의 측정과 에디터 배치 | `artifacts/friction/app/on-01a.tsx` |
| 읽기 카드·본문·플로팅 오버레이 | `artifacts/friction/app/read.tsx` |
| 기록함 일반/선택 목록 및 선택 바 | `artifacts/friction/app/(tabs)/archive.tsx` |
| native/web 리더 본문 렌더러 | `artifacts/friction/components/WebViewMarkdownReader/` |
| 플랫폼별 web inset 정책 | `.agents/skills/expo-web-compat/SKILL.md` |
