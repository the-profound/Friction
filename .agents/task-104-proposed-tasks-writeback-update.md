# Task #104: PROPOSED Task 설명 일괄 업데이트 실행 기록

**실행 일시**: 2026-04-25  
**실행 주체**: Task #104 에이전트  
**수행 방법**: `listProjectTasks(state="PROPOSED")` → `updateProjectTask` 20회 실행 → `getProjectTask`로 전체 재조회 확인

## 업데이트 내용

각 Task description 마지막에 아래 섹션 추가:

```markdown
## Notion Writeback
구현 완료 후 Replit2Notion 스킬의 Quick Writeback 절차에 따라 Notion Queue DB에 완료 기록을 생성한다. 개발 상태는 '개발 완료'로 기록한다.
```

## 업데이트된 Task 목록 (전체 20개, 전수 확인 완료)

| taskRef | title |
|---------|-------|
| #19 | 수신함 빈 상태 문구 화면 중앙 정렬 |
| #20 | [BUG] 새 메모 첫 작성 시 다음 단계 이동하면 내용 미저장 |
| #36 | 자동분할 중 로딩 표시 추가 |
| #38 | 편집 흐름 내보내기 재시도 시 상태 확인 로직 강화 |
| #39 | 나누기 화면에서 뒤로가기 중 저장 진행 상태 표시 |
| #67 | Remove leftover '내 글 모음' collections from existing users' accounts |
| #68 | Remove the unused is_archive database column from collections |
| #75 | 단체 모음 글 목록 visibleAt 필터 자동화 테스트 추가 |
| #76 | 닉네임 중복 여부를 가입 완료 전에 알려주기 |
| #77 | 앱 내 개인정보 처리방침 화면 추가 |
| #79 | Show sent neighbor request count on the main outbox screen |
| #80 | Auto-regenerate the API client instead of maintaining it by hand |
| #81 | Show cover images on received letters in inbox |
| #82 | Let users remove a cover image after it's been saved |
| #83 | Apply back-button save and empty-cancel logic to the splitting and closing editing screens |
| #84 | Make the writing screen's character count reflect title characters too |
| #85 | Show personal collection name on the detail view of inbox letters too |
| #88 | 단체 모음 글 목록에서 작성자 정보 표시 |
| #89 | 단체 모음 스와이프 삭제 E2E 자동화 테스트 추가 |
| #97 | Let users tap outside the editor to dismiss the keyboard on iOS |

## Task #36 설명 변경 전/후 샘플

### 변경 전 (마지막 부분)
```
  ## Relevant files
  - `artifacts/friction/app/on-01b.tsx` (toolbar의 자동분할 버튼, splitPageButton)
```

### 변경 후 (마지막 부분)
```
  ## Relevant files
  - `artifacts/friction/app/on-01b.tsx` (toolbar의 자동분할 버튼, splitPageButton)

## Notion Writeback
구현 완료 후 Replit2Notion 스킬의 Quick Writeback 절차에 따라 Notion Queue DB에 완료 기록을 생성한다. 개발 상태는 '개발 완료'로 기록한다.
```

## Task #20 설명 변경 후 마지막 부분 샘플

```
- `artifacts/friction/app/on-01b.tsx`
- `artifacts/friction/lib/useAutoSave.ts`

## Notion Writeback
구현 완료 후 Replit2Notion 스킬의 Quick Writeback 절차에 따라 Notion Queue DB에 완료 기록을 생성한다. 개발 상태는 '개발 완료'로 기록한다.
```
