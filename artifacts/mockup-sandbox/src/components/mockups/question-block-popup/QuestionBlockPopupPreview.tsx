import { useState } from "react";

/* ─── Tokens ─────────────────────────────────────────────────────── */
const C = {
  zinc900: "#18181b", zinc800: "#27272a", zinc700: "#3f3f46",
  zinc600: "#52525b", zinc500: "#71717a", zinc400: "#a1a1aa",
  zinc300: "#d4d4d8", zinc200: "#e4e4e7", zinc100: "#f4f4f5",
  zinc50: "#fafafa",  white: "#ffffff",
  noticeAccent: "#92323D",
  noticeAccentSoft: "rgba(146,50,61,0.08)",
  noticeAccentBorder: "rgba(146,50,61,0.18)",
};
const FONT  = "'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif";
const SERIF = "'Eulyoo1945-Regular',Georgia,serif";

const PH_W    = 390;
const PH_H    = 820;
const SHEET_H = 630;

/* ─── 눈 아이콘 ───────────────────────────────────────────────────── */
function EyeIcon({ visible }: { visible: boolean }) {
  if (visible) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

/* ─── AI 배지 ─────────────────────────────────────────────────────── */
function AiBadge({ size = 10 }: { size?: number }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      background: C.noticeAccentSoft, border: `1px solid ${C.noticeAccentBorder}`,
      borderRadius: 20, padding: "2px 7px 2px 5px",
      fontSize: size, fontFamily: FONT, fontWeight: 700,
      color: C.noticeAccent, letterSpacing: "0.03em", flexShrink: 0,
    }}>
      <svg width="9" height="9" viewBox="0 0 24 24" fill={C.noticeAccent} stroke="none">
        <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
      </svg>
      AI PICK
    </span>
  );
}

/* ─── 질문 데이터 ─────────────────────────────────────────────────── */
const QUESTIONS: string[] = [
  "작성자가 행복하다고 말한 이유는 무엇일까요?",
  "이 글을 읽고 떠오르는 다른 글이나 경험이 있다면 무엇인가요?",
  "이 글을 읽기 전과 읽은 후, 당신의 생각이 가장 크게 바뀐 지점은 어디인가요?",
];

/* ─── 질문 블록 카드 (글 마지막 페이지 하단) ─────────────────────── */
function ArticleQuestionBlock({ inline = false }: { inline?: boolean }) {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState(["", "", ""]);
  const [rerolling, setRerolling] = useState(false);
  const [closed, setClosed] = useState(false);
  const N = QUESTIONS.length;
  const q = QUESTIONS[idx];

  function reroll() {
    if (rerolling) return;
    setRerolling(true);
    setTimeout(() => setRerolling(false), 480);
  }

  function complete() {
    if (idx < N - 1) setIdx(i => i + 1);
    else setClosed(true);
  }

  if (closed) return null;

  return (
    <div style={{
      ...(inline ? { width: "100%" } : {
        position: "absolute", bottom: 74, left: 12, right: 12, zIndex: 8,
      }),
      background: C.white,
      borderRadius: 16,
      boxShadow: "0 -2px 20px rgba(0,0,0,0.10), 0 4px 16px rgba(0,0,0,0.08)",
      border: `1px solid ${C.zinc100}`,
      padding: "14px 14px 12px",
    }}>
      {/* 헤더: 질문 텍스트 + (1번만) 리롤 + X 닫기 */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 10 }}>
        <span style={{
          flex: 1, fontSize: 13, fontFamily: FONT,
          fontWeight: 600, color: C.zinc700, lineHeight: 1.5,
        }}>
          {q}
        </span>
        {idx === 0 && (
          <button onClick={reroll} style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "2px", flexShrink: 0, marginTop: 1,
            display: "flex", alignItems: "center", color: C.noticeAccent,
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round"
              style={{
                transform: rerolling ? "rotate(360deg)" : "rotate(0deg)",
                transition: rerolling ? "transform 0.45s ease" : "none",
              }}>
              <path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-3"/>
            </svg>
          </button>
        )}
        {/* X 닫기 버튼 */}
        <button onClick={() => setClosed(true)} style={{
          background: "none", border: "none", cursor: "pointer",
          padding: "2px", flexShrink: 0, marginTop: 1,
          display: "flex", alignItems: "center", color: C.zinc400,
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* 답변 입력 — 크게 */}
      <textarea
        value={answers[idx]}
        onChange={(e) => {
          const copy = [...answers];
          copy[idx] = e.target.value;
          setAnswers(copy);
        }}
        placeholder="생각을 기록하세요..."
        rows={4}
        style={{
          width: "100%", border: "none", outline: "none", resize: "none",
          background: C.zinc50, borderRadius: 8, padding: "10px 12px",
          boxSizing: "border-box",
          fontSize: 12.5, fontFamily: SERIF, color: C.zinc700,
          lineHeight: 1.8, letterSpacing: "0.2px",
        }}
      />

      {/* 우하단 체크(완료) 버튼 */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <button onClick={complete} style={{
          width: 30, height: 30, borderRadius: 999,
          background: "rgba(22,163,74,0.10)",
          border: "1px solid rgba(22,163,74,0.28)",
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="#16a34a" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

/* ─── 질문 팝업 카드 (메모 시트 하단) ────────────────────────────── */
function MemoQuestionPopup({ onClose }: { onClose: () => void }) {
  const [answer, setAnswer] = useState("");
  const [spinning, setSpinning] = useState(false);

  function reroll() {
    if (spinning) return;
    setSpinning(true);
    setTimeout(() => setSpinning(false), 450);
  }

  return (
    <div style={{
      position: "absolute",
      bottom: 0, left: 0, right: 0,
      background: C.white,
      borderTopLeftRadius: 16, borderTopRightRadius: 16,
      boxShadow: "0 -4px 20px rgba(0,0,0,0.12)",
      padding: "12px 16px 20px",
      zIndex: 30,
    }}>
      {/* drag hint */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
        <div style={{ width: 28, height: 3, borderRadius: 999, background: C.zinc200 }}/>
      </div>
      {/* header row */}
      <div style={{
        display: "flex", alignItems: "flex-start", gap: 6,
        paddingRight: 28, marginBottom: 9,
      }}>
        <AiBadge />
        <span style={{
          flex: 1, minWidth: 0, fontSize: 13, fontFamily: FONT,
          fontWeight: 600, color: C.zinc700, lineHeight: 1.5,
        }}>
          작성자가 행복하다고 말한 이유는 무엇일까요?
        </span>
        <button onClick={reroll} style={{
          display: "flex", alignItems: "center",
          background: "transparent", border: "none", cursor: "pointer",
          padding: "3px", borderRadius: 6, flexShrink: 0,
          opacity: spinning ? 0.45 : 1, transition: "opacity 0.15s",
        }}>
          <span style={{ display: "inline-block", animation: spinning ? "spin 0.45s linear" : "none" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke={C.noticeAccent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-3"/>
            </svg>
          </span>
        </button>
      </div>
      {/* answer */}
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="생각을 기록하세요..."
        rows={3}
        style={{
          width: "100%", border: "none", outline: "none", resize: "none",
          background: "transparent", padding: 0, boxSizing: "border-box",
          fontSize: 13, fontFamily: SERIF, color: C.zinc700,
          lineHeight: 1.75, letterSpacing: "0.3px",
        }}
      />
      {/* × close */}
      <button onClick={onClose} style={{
        position: "absolute", top: 10, right: 12,
        width: 26, height: 26, borderRadius: 8,
        background: C.zinc100, border: "none", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
      }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke={C.zinc500} strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  );
}

/* ─── 자유 메모 ───────────────────────────────────────────────────── */
function FreeMemo({ initialText = "" }: { initialText?: string }) {
  const [text, setText] = useState(initialText);
  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      placeholder="자유롭게 메모하세요..."
      style={{
        width: "100%", border: "none", outline: "none", resize: "none",
        background: "transparent", padding: 0, boxSizing: "border-box",
        fontSize: 14, fontFamily: SERIF, color: C.zinc700,
        lineHeight: 1.85, letterSpacing: "0.3px", minHeight: 220,
      }}
    />
  );
}

/* ─── 아티클 텍스트 ───────────────────────────────────────────────── */
const ARTICLE_LINES = [
  "빗소리는 언제나 사람을 생각하게 만든다. 아무것도 하지 않아도 된다는 허락처럼, 창밖의 빗줄기는 조용히 내린다.",
  "오늘도 그런 날이었다. 빗소리를 들으며 커피 한 잔을 손에 쥐고, 나는 한동안 아무 생각도 하지 않으려 했다. 그러나 생각은 멈추지 않았다.",
  "행복이란 거창한 것이 아니라는 걸, 비 오는 날은 늘 다시 일깨워 준다. 지금 이 자리, 이 온기, 이 고요함. 그것으로 충분하다.",
  "이상으로 글을 마친다.",
];

/* ─── Phone Frame ─────────────────────────────────────────────────── */
function PhoneFrame({
  showQuestionBlock,
  memoOpen,
  popupVisible,
  showMemoButton = false,
  memoInitialText = "",
  onOpenMemo,
  onCloseMemo,
  onClosePopup,
}: {
  showQuestionBlock: boolean;
  memoOpen: boolean;
  popupVisible: boolean;
  showMemoButton?: boolean;
  memoInitialText?: string;
  onOpenMemo: () => void;
  onCloseMemo: () => void;
  onClosePopup: () => void;
}) {
  return (
    <div style={{
      width: PH_W, height: PH_H, borderRadius: 44, overflow: "hidden",
      background: "#1a1a1e",
      boxShadow: "0 0 0 2px #3a3a3e, 0 0 0 4px #28282c, 0 28px 90px rgba(0,0,0,0.55)",
      position: "relative", flexShrink: 0,
    }}>
      {/* status bar */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 48,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 22px 0", zIndex: 40,
      }}>
        <span style={{ fontSize: 12, fontFamily: FONT, fontWeight: 600, color: C.white }}>9:41</span>
        <div style={{
          position: "absolute", left: "50%", top: 10, transform: "translateX(-50%)",
          width: 120, height: 32, background: "#000", borderRadius: 20,
        }}/>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <svg width="16" height="12" viewBox="0 0 16 12" fill={C.white}>
            <rect x="0" y="6" width="3" height="6" rx="0.5"/>
            <rect x="4" y="4" width="3" height="8" rx="0.5"/>
            <rect x="8" y="2" width="3" height="10" rx="0.5"/>
            <rect x="12" y="0" width="3" height="12" rx="0.5"/>
          </svg>
          <svg width="16" height="12" viewBox="0 0 16 12" fill={C.white}>
            <path d="M8 2a8 8 0 0 1 5.7 2.4l1.1-1.1A9.7 9.7 0 0 0 8 0a9.7 9.7 0 0 0-6.8 3.3l1.1 1.1A8 8 0 0 1 8 2z"/>
            <path d="M8 5a5 5 0 0 1 3.5 1.5l1.1-1.2A6.8 6.8 0 0 0 8 3.2a6.8 6.8 0 0 0-4.6 2l1.1 1.1A5 5 0 0 1 8 5z"/>
            <circle cx="8" cy="10" r="1.5"/>
          </svg>
          <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
            <rect x="0" y="1" width="21" height="10" rx="2" stroke={C.white} strokeWidth="1.2"/>
            <rect x="22" y="4" width="2" height="4" rx="1" fill={C.white} opacity="0.5"/>
            <rect x="1.5" y="2.5" width="17" height="7" rx="1.2" fill={C.white}/>
          </svg>
        </div>
      </div>

      {/* reader layout */}
      <div style={{
        position: "absolute", inset: 0, background: C.white,
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* status bar spacer */}
        <div style={{ height: 48, flexShrink: 0 }}/>

        {/* header — back arrow */}
        <div style={{
          height: 52, flexShrink: 0,
          display: "flex", alignItems: "center",
          paddingLeft: 24, paddingRight: 24,
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke={C.zinc600} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </div>

        {/* page card area */}
        {showQuestionBlock && !memoOpen ? (
          /* ── Phone 1: 카드 축소 + 질문 블록 + 버튼을 세로 스택 ── */
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", paddingTop: 10,
            overflow: "hidden",
          }}>
            {/* 70% 축소 카드 */}
            <div style={{
              width: PH_W, height: 592,
              background: C.white, position: "relative", overflow: "hidden",
              boxShadow: "0 -8px 20px rgba(0,0,0,0.06), 0 8px 20px rgba(0,0,0,0.06)",
              transform: "scale(0.7)", transformOrigin: "top center",
              marginBottom: -(592 * 0.3),
              flexShrink: 0,
            }}>
              <div style={{
                position: "absolute", inset: 0,
                padding: "20px 20px 38px",
                display: "flex", flexDirection: "column", justifyContent: "center",
              }}>
                {ARTICLE_LINES.map((line, i) => (
                  <p key={i} style={{
                    margin: "0 0 18px 0",
                    fontSize: 15.2, fontFamily: SERIF, fontWeight: 400,
                    color: i === 3 ? C.zinc400 : "#1a1a1a",
                    lineHeight: 1.8, letterSpacing: "0.05em",
                    fontStyle: i === 3 ? "italic" : "normal",
                  }}>{line}</p>
                ))}
              </div>
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0, height: 38,
                borderTop: `1px solid ${C.zinc100}`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{ fontSize: 12.5, fontFamily: FONT, color: C.zinc400 }}>비 오는 날의 단상</span>
              </div>
            </div>

            {/* 카드와 질문 블록 사이 간격 */}
            <div style={{ height: 10, flexShrink: 0 }}/>

            {/* 질문 블록 — 인라인 */}
            <div style={{ width: "calc(100% - 24px)", flexShrink: 0 }}>
              <ArticleQuestionBlock inline />
            </div>

          </div>
        ) : (
          /* ── 그 외 Phone: 카드 중앙 배치 ── */
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{
              width: PH_W, height: 592,
              background: C.white, position: "relative", overflow: "hidden",
              boxShadow: "0 -8px 20px rgba(0,0,0,0.06), 0 8px 20px rgba(0,0,0,0.06)",
            }}>
              <div style={{
                position: "absolute", inset: 0,
                padding: "20px 20px 38px",
                display: "flex", flexDirection: "column", justifyContent: "center",
              }}>
                {ARTICLE_LINES.map((line, i) => (
                  <p key={i} style={{
                    margin: "0 0 18px 0",
                    fontSize: 15.2, fontFamily: SERIF, fontWeight: 400,
                    color: i === 3 ? C.zinc400 : "#1a1a1a",
                    lineHeight: 1.8, letterSpacing: "0.05em",
                    fontStyle: i === 3 ? "italic" : "normal",
                  }}>{line}</p>
                ))}
              </div>
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0, height: 38,
                borderTop: `1px solid ${C.zinc100}`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <span style={{ fontSize: 12.5, fontFamily: FONT, color: C.zinc400 }}>비 오는 날의 단상</span>
              </div>
            </div>
          </div>
        )}

        {/* bottom bar */}
        <div style={{
          height: 68, flexShrink: 0, background: C.white,
          display: "flex", alignItems: "center",
          paddingLeft: 24, paddingRight: 88,
        }}>
          <div style={{ flex: 1, height: 2, borderRadius: 1, background: C.zinc200, overflow: "hidden" }}>
            <div style={{ width: "100%", height: "100%", background: C.zinc900, borderRadius: 1 }}/>
          </div>
        </div>
      </div>

      {/* 메모 버튼 (Phone 1) or 눈 버튼 (Phone 2, 3) */}
      {showMemoButton ? (
        <button onClick={onOpenMemo} style={{
          position: "absolute", bottom: 14, right: 24, zIndex: 35,
          width: 40, height: 40, borderRadius: 999,
          background: "none", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: C.zinc500,
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
        </button>
      ) : (
        <button onClick={memoOpen ? onCloseMemo : onOpenMemo} style={{
          position: "absolute", bottom: 14, right: 24, zIndex: 35,
          width: 40, height: 40, borderRadius: 999,
          background: "none", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: C.zinc500,
        }}>
          <EyeIcon visible={memoOpen} />
        </button>
      )}

      {/* dim */}
      <div style={{
        position: "absolute", inset: 0, zIndex: 5,
        background: "rgba(0,0,0,0.35)",
        opacity: memoOpen ? 1 : 0,
        transition: "opacity 0.25s ease",
        pointerEvents: "none",
      }}/>

      {/* memo bottom sheet */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        height: SHEET_H, zIndex: 10,
        background: C.white,
        borderTopLeftRadius: 22, borderTopRightRadius: 22,
        display: "flex", flexDirection: "column",
        opacity: memoOpen ? 1 : 0,
        transform: memoOpen ? "translateY(0)" : "translateY(40px)",
        pointerEvents: memoOpen ? "auto" : "none",
        transition: "opacity 0.25s ease, transform 0.25s ease",
      }}>
        {/* drag handle */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 10, paddingBottom: 4 }}>
          <div style={{ width: 36, height: 4, borderRadius: 999, background: C.zinc300 }}/>
        </div>
        {/* title row */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "6px 14px 8px 18px",
        }}>
          <span style={{ fontSize: 15, fontFamily: FONT, fontWeight: 700, color: C.zinc800 }}>
            〈비 오는 날의 단상〉을 읽고
          </span>
          <button onClick={onCloseMemo} style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "4px 2px",
            fontSize: 14, fontFamily: FONT, fontWeight: 400,
            color: C.zinc400, lineHeight: 1,
          }}>
            닫기
          </button>
        </div>
        {/* divider */}
        <div style={{ height: 1, background: C.zinc100, margin: "0 16px" }}/>
        {/* scrollable memo area */}
        <div style={{
          flex: 1, overflowY: "auto",
          padding: `10px 16px ${popupVisible ? 175 : 20}px`,
          transition: "padding-bottom 0.2s ease",
          position: "relative",
        }}>
          <FreeMemo initialText={memoInitialText} />
        </div>
        {/* question popup (within memo sheet) */}
        {popupVisible && <MemoQuestionPopup onClose={onClosePopup} />}
      </div>
    </div>
  );
}

/* ─── Phone label chip ────────────────────────────────────────────── */
function Label({ text }: { text: string }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center",
      background: C.white, borderRadius: 20, padding: "5px 13px",
      fontSize: 11, fontFamily: FONT, fontWeight: 600, color: C.zinc600,
      border: `1px solid ${C.zinc200}`,
    }}>
      {text}
    </div>
  );
}

/* ─── Main ────────────────────────────────────────────────────────── */
export function QuestionBlockPopupPreview() {
  return (
    <>
      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(-360deg)} }
        ::-webkit-scrollbar { width:0; height:0 }
      `}</style>

      <div style={{
        minHeight: "100vh", background: "#e2e0db",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "flex-start",
        padding: "40px 32px 72px", fontFamily: FONT, gap: 28,
      }}>
        {/* header */}
        <div style={{ textAlign: "center" }}>
          <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: "#27272a", letterSpacing: "-0.03em" }}>
            메모 + 질문 블록 팝업
          </h1>
          <p style={{ margin: "5px 0 0", fontSize: 11, color: C.zinc400 }}>
            질문 블록은 글 마지막 페이지에 표시 · 메모 시트에서 팝업으로 재등장
          </p>
        </div>

        {/* 3 phones */}
        <div style={{
          display: "flex", gap: 28, alignItems: "flex-start",
          flexWrap: "wrap", justifyContent: "center",
        }}>
          {/* Phone 1 — 질문 블록 표시 (메모 버튼) */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <Label text="① 질문 블록 표시" />
            <PhoneFrame
              showQuestionBlock={true}
              memoOpen={false}
              popupVisible={false}
              showMemoButton={true}
              onOpenMemo={() => {}}
              onCloseMemo={() => {}}
              onClosePopup={() => {}}
            />
          </div>

          {/* Phone 2 — 메모 시트 열림 (질문 블록 없음) */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <Label text="② 메모 팝업 표시" />
            <PhoneFrame
              showQuestionBlock={false}
              memoOpen={true}
              popupVisible={false}
              memoInitialText={"작성자가 행복하다고 말한 이유는 무엇일까요?\n비가 오는 하루에서 자신이 좋아하는 자리와 온기와 고요함을 마주했기 때문이다."}
              onOpenMemo={() => {}}
              onCloseMemo={() => {}}
              onClosePopup={() => {}}
            />
          </div>

          {/* Phone 3 — 눈 아이콘 OFF (메모 숨김) */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <Label text="③ 팝업 닫은 후" />
            <PhoneFrame
              showQuestionBlock={false}
              memoOpen={false}
              popupVisible={false}
              onOpenMemo={() => {}}
              onCloseMemo={() => {}}
              onClosePopup={() => {}}
            />
          </div>
        </div>
      </div>
    </>
  );
}

export default QuestionBlockPopupPreview;
