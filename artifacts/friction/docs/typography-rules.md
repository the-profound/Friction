# Friction 타이포그래피 최소 가독성 규칙

이 문서는 Friction 앱에서 새 화면이나 컴포넌트를 만들 때 지켜야 하는 텍스트 스타일 최소 기준을 정리한다.
기준 위반은 `pnpm --filter @workspace/friction check:typography` 로 자동 검사된다.

---

## 배경: 왜 이 규칙이 필요한가

Pretendard ExtraLight(200)은 웹 브라우저 미리보기에서는 읽기 쉬워 보이지만, **네이티브 iOS/Android 기기에서는 같은 폰트 크기라도 훨씬 얇게 렌더링된다.** ExtraLight + 소형 크기(11 px 이하) + 연한 회색이 함께 쓰이면 기기에서 읽기 어려운 텍스트가 된다. 웹 미리보기를 기준으로 스타일을 결정하면 이 조합이 반복적으로 들어오게 된다.

---

## 최소 규칙 요약

| 항목 | 기준 | 참조 상수 |
|---|---|---|
| 최소 폰트 크기 | 12 px | `ReadabilityMinimums.fontSizePx` |
| 최소 폰트 웨이트 (본문/보조) | Regular 400 | `ReadabilityMinimums.fontWeightRegular` |
| 소형 텍스트(12–13 px) 권장 웨이트 | Medium 500 | `ReadabilityMinimums.fontWeightSmallRecommended` |
| 본문/보조 텍스트 최소 색 | zinc500 (#71717a) | `ReadabilityMinimums.textColorMinStep` |

---

## 용도별 토큰 선택 표

| 용도 | 사용할 토큰 | 색 |
|---|---|---|
| 화면 헤더 제목 | `Typography.headerTitle` | `Colors.zinc900` |
| 날짜 헤더 | `Typography.dateHeader` | `Colors.zinc800` |
| 본문 텍스트 | `Typography.body` | `Colors.zinc800` 이상 |
| 보조/메타 텍스트 | `Typography.caption` | `Colors.zinc500` 이상 |
| 강조 메타 | `Typography.captionMedium` | `Colors.zinc500` 이상 |
| 검색 입력 | `Typography.searchInput` | `Colors.searchText` |
| 대형 장식 텍스트 | `Typography.bodyExtraLight` | 큰 크기(16 px+)에서만 허용 |

### 색 사용 기준

```
Colors.zinc900/800/700/600  →  주 텍스트, 강조
Colors.zinc500              →  보조 텍스트, 메타데이터, 빈 화면 설명 (최소선)
Colors.zinc400              →  placeholder, 비활성(disabled), 장식 도트, 아이콘만
Colors.zinc300              →  border, 구분선 배경만 (텍스트 color로 절대 불가)
```

---

## ExtraLight 허용 범위

`Pretendard-ExtraLight` / `fontWeight: "200"` 은 아래 두 경우만 허용된다:

1. **탭 바 레이블** (`Typography.tabLabel`) — 탭 아이콘이 주 affordance이고 레이블은 보조 크롬이다. 이것이 유일한 sub-12 px ExtraLight 공인 예외.
2. **대형 장식 텍스트** (`Typography.bodyExtraLight`) — 16 px 이상의 표제나 인트로 텍스트에서만 사용. 소형·보조 텍스트에는 절대 불가.

컴포넌트 파일에서 `"Pretendard-ExtraLight"` 문자열을 직접 쓰는 것은 위반이다. 반드시 토큰을 통해 사용한다.

---

## 자동 검사 (`check:typography`)

```bash
pnpm --filter @workspace/friction check:typography
```

아래 패턴을 검사하며, 위반 시 파일·줄·권장 대안을 출력하고 exit 1 로 실패한다:

| 검사 ID | 패턴 | 설명 |
|---|---|---|
| `extralight-direct` | `fontFamily: "Pretendard-ExtraLight"` | 컴포넌트에서 ExtraLight 직접 지정 |
| `fontweight-200` | `fontWeight: "200"` | 컴포넌트에서 200 웨이트 직접 지정 |
| `fontsize-below-12` | `fontSize: <12` | 12 px 미만 UI 텍스트 |
| `text-color-zinc400` | `color: Colors.zinc400` | 본문색으로 zinc400 이하 사용 |
| `text-color-zinc300` | `color: Colors.zinc300` | 본문색으로 zinc300 이하 사용 |

**검사에서 제외되는 경로:**

- `constants/tokens.ts` — 토큰 정의 파일 (tabLabel 예외가 여기 있음)
- `app/_layout.tsx` — 폰트 등록 코드
- `components/shared/bodyTypographyCss.ts` — 리더 WebView CSS (Eulyoo1945 본문체)
- `components/WebViewMarkdownEditor/` — 에디터 WebView HTML/CSS
- `components/WebViewMarkdownReader/` — 리더 WebView HTML/CSS

---

## 의도적 예외 처리 방법

자동 검사를 통과시켜야 하는 정당한 예외에는 해당 줄 끝에 `// typography-ok: <이유>` 를 붙인다.

```tsx
// ❌ 위반 — 검사에 걸림
const styles = StyleSheet.create({
  hintText: { color: Colors.zinc400, fontSize: 13 },
});

// ✅ 예외 표시 — 이유가 명확할 때만
const styles = StyleSheet.create({
  hintText: { color: Colors.zinc400, fontSize: 13 }, // typography-ok: form hint text
  disabledLabel: { color: Colors.zinc400, fontSize: 14 }, // typography-ok: disabled button text
});
```

**예외를 허용하는 경우:**

| 상황 | 예시 | 허용 여유 |
|---|---|---|
| placeholder / ghost 텍스트 | 입력창 placeholder, 선택 전 상태 | zinc400 허용 |
| 비활성(disabled) 상태 | 비활성 버튼, 잠긴 항목 | zinc400 허용 |
| 장식 도트 / 구분자 | · 구분 메타 도트 | zinc400 허용 |
| 공간 제약 초소형 배지 | 18 px 원형 아바타 칩 | fontSize 9–10 허용 |
| 탭 비활성 레이블 | 서브탭 텍스트 | zinc400 허용 |

**예외를 허용하지 않는 경우:**

- 일반 빈 화면(empty state) 설명 텍스트 → zinc500 이상
- 메타데이터 레이블(날짜, 출처, 페이지 번호) → zinc500 이상
- 본문/보조 설명 텍스트 → zinc500 이상
- ExtraLight를 소형 텍스트(< 16 px)에 사용 → Regular 이상으로 변경

---

## 새 화면 개발 체크리스트

- [ ] 모든 텍스트 스타일이 `Typography.*` 토큰을 사용하거나, 직접 지정 시 12 px 이상인가?
- [ ] 본문/보조 텍스트 색이 `Colors.zinc500` 이상인가?
- [ ] `"Pretendard-ExtraLight"` 또는 `fontWeight: "200"` 을 컴포넌트에서 직접 쓰지 않았는가?
- [ ] `pnpm check:typography` 를 실행하여 새로 추가한 코드가 통과하는가?
- [ ] 예외를 추가했다면 `// typography-ok: <이유>` 주석이 명확하게 달려 있는가?
