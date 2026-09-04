# iOS 작성 줄바꿈 실기기 확인

## 준비

1. iOS와 Android 실기기에서 같은 개발 빌드를 열고, Web 작성 화면도 함께 연다.
2. 세 환경의 논리 페이지 폭이 같도록 세로 화면 폭을 맞춘다.
3. 아래 표본을 서식 없이 붙여넣은 뒤 제목·목록·인용은 작성 툴바로 다시 적용한다.

```md
# iOS 줄바꿈 확인

가나다라마바사아자차카타파하 같은 한국어 문단의 자동 줄바꿈을 확인합니다.
Korean and English mixed words 사이의 띄어쓰기 경계도 같은 위치인지 확인합니다.
공백없는긴문자열공백없는긴문자열공백없는긴문자열

- 목록과 mixed English item의 줄바꿈
1. 순서 목록과 한글 English 경계

> 인용문에서도 같은 폭과 글꼴로 줄바꿈되어야 합니다.
```

## 비교 절차

1. 각 환경에서 문단별 줄 끝 글자를 기록한다.
2. iOS 개발 콘솔의 `[bodyTypography:editor]` 진단을 확인한다.
   - `domWidthPx`가 전달한 본문 폭과 같아야 한다.
   - `fontSizePx`, `lineHeightPx`, `letterSpacingPx`,
     `effectiveFontScaleRatio`가 공통 계약과 같아야 한다.
   - `fontFamily`, 네 폰트 준비 상태, `lineBreakOffsets`로 폰트 실패와
     WebKit 줄바꿈 차이를 구분한다.
   - 같은 화면 상태에서는 가장 큰 `layoutGeneration`의 결과만 비교한다.
3. 키보드를 열고 닫은 뒤 같은 줄 끝 글자와 진단 값을 다시 확인한다.
4. 화면을 나갔다가 다시 진입한 뒤 확인한다.
5. 기기를 가로로 회전했다가 세로로 되돌린 뒤 확인한다.
6. 개발 메뉴에서 앱을 다시 로드한 뒤 확인한다.

## 통과 기준

- iOS, Android, Web에서 각 표본의 줄 끝 글자와 줄당 글자 수가 같다.
- 키보드, 재진입, 회전, WebView 재로딩 뒤에도 이전
  `layoutGeneration`의 폭이나 폰트 메트릭으로 돌아가지 않는다.
- 폰트 검증이 실패한 경우 원인이 `reason`, `loads`, `glyphs`에 나타나며,
  세 네이티브 본문 렌더러가 같은 fallback 모드로 고정된다.