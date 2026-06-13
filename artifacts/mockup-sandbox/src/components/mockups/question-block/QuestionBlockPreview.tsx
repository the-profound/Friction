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

/* ─── Palettes ────────────────────────────────────────────────────── */
const PALETTE = {
  summary: { accent: "#92570a", bg: "#fef9ee", border: "rgba(180,120,0,0.18)",    label: "요약"    },
  ai:      { accent: C.noticeAccent, bg: C.noticeAccentSoft, border: C.noticeAccentBorder, label: "AI PICK" },
  manual:  { accent: C.noticeAccent, bg: C.noticeAccentSoft, border: C.noticeAccentBorder, label: "직접입력" },
  emotion: { accent: "#6d28d9", bg: "#f5f3ff", border: "rgba(109,40,217,0.18)",   label: "감정"    },
  connect: { accent: "#6d28d9", bg: "#f5f3ff", border: "rgba(109,40,217,0.18)",   label: "연결"    },
  change:  { accent: "#0f766e", bg: "#f0fdfa", border: "rgba(15,118,110,0.18)",   label: "변화"    },
  action:  { accent: "#0f766e", bg: "#f0fdfa", border: "rgba(15,118,110,0.18)",   label: "실천"    },
  counter: { accent: "#b45309", bg: "#fff7ed", border: "rgba(180,83,9,0.18)",     label: "반론"    },
  curious: { accent: "#b45309", bg: "#fff7ed", border: "rgba(180,83,9,0.18)",     label: "궁금증"  },
};
type PaletteKey = keyof typeof PALETTE;

const KEYWORD_PALETTE: Record<string, PaletteKey> = {
  "AI픽": "ai", "직접입력": "manual",
  "감정": "emotion", "연결": "connect",
  "변화": "change",  "실천": "action",
  "반론": "counter", "궁금증": "curious",
};
const KEYWORDS = ["AI픽", "직접입력", "감정", "연결", "변화", "실천", "반론", "궁금증"];

const PH_W    = 390;
const PH_H    = 820;
const SHEET_H = 690;

/* ─── Block shared styles ─────────────────────────────────────────── */
const blockWrap = (accent: string): React.CSSProperties => ({
  background: C.white, borderRadius: 12, marginBottom: 10,
  border: `1px solid ${C.zinc100}`,
  boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
  borderLeft: `3px solid ${accent}`,
  padding: "11px 10px 10px 13px",
  position: "relative",
});
const blockHeaderRow: React.CSSProperties = {
  display: "flex", alignItems: "flex-start", gap: 6, flexWrap: "wrap",
  paddingRight: 22,
};
const qText: React.CSSProperties = {
  flex: 1, minWidth: 0, fontSize: 13, fontFamily: FONT,
  fontWeight: 600, color: C.zinc700, lineHeight: 1.55,
};

/* ─── × block close ───────────────────────────────────────────────── */
function CloseBtn({ onClose }: { onClose: () => void }) {
  return (
    <button onClick={onClose} style={{
      position: "absolute", top: 9, right: 9,
      width: 22, height: 22, borderRadius: 6,
      background: "transparent", border: "none", cursor: "pointer",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
    }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
        stroke={C.zinc400} strokeWidth="2.5" strokeLinecap="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  );
}

/* ─── Badge ───────────────────────────────────────────────────────── */
function Badge({ pk, size = 10 }: { pk: PaletteKey; size?: number }) {
  const p = PALETTE[pk];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      background: p.bg, border: `1px solid ${p.border}`,
      borderRadius: 20, padding: "2px 7px 2px 5px",
      fontSize: size, fontFamily: FONT, fontWeight: 700,
      color: p.accent, letterSpacing: "0.03em", flexShrink: 0,
    }}>
      {pk === "ai" && (
        <svg width="9" height="9" viewBox="0 0 24 24" fill={p.accent} stroke="none">
          <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
        </svg>
      )}
      {pk === "summary" && (
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={p.accent} strokeWidth="2.5" strokeLinecap="round">
          <line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="16" y2="12"/><line x1="4" y1="17" x2="12" y2="17"/>
        </svg>
      )}
      {p.label}
    </span>
  );
}

/* ─── Reroll (icon only) ──────────────────────────────────────────── */
function RerollBtn({ onClick, spinning }: { onClick: () => void; spinning: boolean }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center",
      background: "transparent", border: "none", cursor: "pointer",
      padding: "3px", borderRadius: 6,
      opacity: spinning ? 0.45 : 1, transition: "opacity 0.15s",
    }}>
      <span style={{ display: "inline-block", animation: spinning ? "spin 0.45s linear" : "none" }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
          stroke={C.noticeAccent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-3"/>
        </svg>
      </span>
    </button>
  );
}

/* ─── Answer textarea ─────────────────────────────────────────────── */
function AnswerArea({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <textarea value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder} rows={3}
      style={{
        width: "100%", border: "none", outline: "none", resize: "none",
        background: "transparent", padding: 0, boxSizing: "border-box",
        fontSize: 13, fontFamily: SERIF, color: C.zinc700,
        lineHeight: 1.75, letterSpacing: "0.3px", marginTop: 8,
      }}
    />
  );
}

/* ─── Block 1: 요약 ───────────────────────────────────────────────── */
function SummaryBlock({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState(
    "작가는 일상의 작은 순간들이 모여 삶의 의미를 만든다고 말하고 있어요. 비 오는 날의 고요함이 그 단상의 출발점이었고요.",
  );
  return (
    <div style={blockWrap(PALETTE.summary.accent)}>
      <CloseBtn onClose={onClose} />
      <div style={blockHeaderRow}>
        <Badge pk="summary" />
        <span style={qText}>작성자가 하고자 하는 말은 무엇이었나요?</span>
      </div>
      <AnswerArea value={text} onChange={setText} placeholder="요약 내용을 적어보세요..." />
    </div>
  );
}

/* ─── Block 2: AI pick ────────────────────────────────────────────── */
function AiBlock({ spinning, onReroll, onClose }: {
  spinning: boolean; onReroll: () => void; onClose: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <div style={blockWrap(C.noticeAccent)}>
      <CloseBtn onClose={onClose} />
      <div style={blockHeaderRow}>
        <Badge pk="ai" />
        <span style={qText}>작성자가 행복하다고 말한 이유는 무엇일까요?</span>
        <RerollBtn onClick={onReroll} spinning={spinning} />
      </div>
      <AnswerArea value={text} onChange={setText} placeholder="생각을 기록하세요..." />
    </div>
  );
}

/* ─── Block 3: 키워드 선택 ────────────────────────────────────────── */
function KeywordBlock({ selected, onToggle, onClose }: {
  selected: Set<string>; onToggle: (k: string) => void; onClose: () => void;
}) {
  return (
    <div style={blockWrap(C.zinc300)}>
      <CloseBtn onClose={onClose} />
      <div style={{ marginBottom: 10, paddingRight: 22 }}>
        <span style={{ fontSize: 12, fontFamily: FONT, fontWeight: 600, color: C.zinc600 }}>
          추가 질문을 선택하세요
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
        {KEYWORDS.map((kw) => {
          const pk = KEYWORD_PALETTE[kw];
          const p = PALETTE[pk];
          const on = selected.has(kw);
          return (
            <button key={kw} onClick={() => onToggle(kw)} style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "5px 11px", borderRadius: 20, cursor: "pointer",
              border: `1.5px solid ${on ? p.accent : C.zinc200}`,
              background: on ? p.bg : C.white,
              fontSize: 12, fontFamily: FONT, fontWeight: on ? 600 : 400,
              color: on ? p.accent : C.zinc500,
              transition: "all 0.15s",
            }}>
              {on && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                  stroke={p.accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
              {kw}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── 질문 블록 추가 ──────────────────────────────────────────────── */
function AddBlockButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      width: "100%", height: 42, borderRadius: 12,
      border: `1.5px dashed ${C.zinc300}`,
      background: "transparent", cursor: "pointer",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      marginTop: 2, transition: "background 0.15s",
    }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
        stroke={C.zinc400} strokeWidth="2.5" strokeLinecap="round">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      <span style={{ fontSize: 12, fontFamily: FONT, fontWeight: 500, color: C.zinc400 }}>
        질문 블록 추가
      </span>
    </button>
  );
}

/* ─── 자유 메모 영역 ──────────────────────────────────────────────── */
function FreeMemo() {
  const [text, setText] = useState("");
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ height: 1, background: C.zinc100, marginBottom: 12 }}/>
      <textarea value={text} onChange={(e) => setText(e.target.value)}
        placeholder="자유롭게 메모하세요..."
        style={{
          width: "100%", border: "none", outline: "none", resize: "none",
          background: "transparent", padding: 0, boxSizing: "border-box",
          fontSize: 14, fontFamily: SERIF, color: C.zinc700,
          lineHeight: 1.85, letterSpacing: "0.3px", minHeight: 80,
        }}
      />
    </div>
  );
}

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

/* ─── Phone frame ─────────────────────────────────────────────────── */
function PhoneFrame({
  memoVisible,
  onToggleMemo,
  onCloseMemo,
  children,
}: {
  memoVisible: boolean;
  onToggleMemo: () => void;
  onCloseMemo: () => void;
  children: React.ReactNode;
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
        padding: "14px 22px 0", zIndex: 20,
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

      {/* ── Friction reader layout ─────────────────────────────────── */}
      <div style={{
        position: "absolute", inset: 0, background: C.white,
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* status bar spacer */}
        <div style={{ height: 48, flexShrink: 0 }}/>

        {/* header row — back arrow */}
        <div style={{
          height: 60, flexShrink: 0,
          display: "flex", alignItems: "center",
          paddingLeft: 24, paddingRight: 24,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke={C.zinc600} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </div>
        </div>

        {/* page frame area — flex:1, vertically + horizontally centered */}
        <div style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {/* page card: 5:8 ratio = 390×624 */}
          <div style={{
            width: 390, height: 624,
            background: C.white, position: "relative", overflow: "hidden",
            boxShadow: "0 -10px 24px rgba(0,0,0,0.07), 0 10px 24px rgba(0,0,0,0.07)",
          }}>
            {/* body text — aligned to bottom, above title bar (38px) */}
            <div style={{
              position: "absolute", inset: 0,
              paddingLeft: 20, paddingRight: 20,
              paddingTop: 20, paddingBottom: 38,
              display: "flex", flexDirection: "column", justifyContent: "center",
            }}>
              {[
                "빗소리는 언제나 사람을 생각하게 만든다. 아무것도 하지 않아도 된다는 허락처럼, 창밖의 빗줄기는 조용히 내린다.",
                "오늘도 그런 날이었다. 빗소리를 들으며 커피 한 잔을 손에 쥐고, 나는 한동안 아무 생각도 하지 않으려 했다. 그러나 생각은 멈추지 않았다.",
                "행복이란 거창한 것이 아니라는 걸, 비 오는 날은 늘 다시 일깨워 준다. 지금 이 자리, 이 온기, 이 고요함. 그것으로 충분하다.",
                "이상으로 글을 마친다.",
              ].map((line, i) => (
                <p key={i} style={{
                  margin: "0 0 20px 0",
                  fontSize: 15.6, fontFamily: SERIF, fontWeight: 400,
                  color: i === 3 ? C.zinc400 : "#1a1a1a",
                  lineHeight: 1.8, letterSpacing: "0.05em",
                  fontStyle: i === 3 ? "italic" : "normal",
                }}>
                  {line}
                </p>
              ))}
            </div>

            {/* title bar overlay — absolute bottom of page card */}
            <div style={{
              position: "absolute", bottom: 0, left: 0, right: 0,
              height: 38,
              borderTop: `1px solid ${C.zinc100}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              paddingLeft: 24, paddingRight: 24,
            }}>
              <span style={{
                fontSize: 13, fontFamily: FONT, fontWeight: 400,
                color: C.zinc400, letterSpacing: "0.03em",
              }}>
                {memoVisible ? "비 오는 날의 단상" : "읽기 후 메모 작성중"}
              </span>
            </div>
          </div>
        </div>

        {/* bottom bar — progress (stops before eye button: 40px btn + 24px gap + 24px right = 88px) */}
        <div style={{
          height: 68, flexShrink: 0, background: C.white,
          display: "flex", alignItems: "center",
          paddingLeft: 24, paddingRight: 88,
        }}>
          <div style={{
            flex: 1, height: 2, borderRadius: 1, background: C.zinc200, overflow: "hidden",
          }}>
            <div style={{ width: "72%", height: "100%", background: C.zinc900, borderRadius: 1 }}/>
          </div>
        </div>
      </div>

      {/* eye toggle — absolute, always same position above sheet */}
      <button onClick={onToggleMemo} style={{
        position: "absolute", bottom: 14, right: 24, zIndex: 15,
        width: 40, height: 40, borderRadius: 999,
        background: "none", border: "none", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: C.zinc500,
      }}>
        <EyeIcon visible={memoVisible} />
      </button>

      {/* dim overlay — fades in when memo visible */}
      <div style={{
        position: "absolute", inset: 0, zIndex: 5,
        background: "rgba(0,0,0,0.38)",
        opacity: memoVisible ? 1 : 0,
        transition: "opacity 0.3s ease",
        pointerEvents: "none",
      }}/>

      {/* bottom sheet */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        height: SHEET_H, zIndex: 10,
        background: C.white,
        borderTopLeftRadius: 22, borderTopRightRadius: 22,
        display: "flex", flexDirection: "column",
        opacity: memoVisible ? 1 : 0,
        pointerEvents: memoVisible ? "auto" : "none",
        transition: "opacity 0.3s ease",
      }}>
        {/* drag handle */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 10, paddingBottom: 6 }}>
          <div style={{ width: 36, height: 4, borderRadius: 999, background: C.zinc300 }}/>
        </div>

        {/* title row with close button */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "6px 14px 8px 18px",
        }}>
          <span style={{ fontSize: 15, fontFamily: FONT, fontWeight: 700, color: C.zinc800 }}>
            〈비 오는 날의 단상〉을 읽고
          </span>
          <button onClick={onCloseMemo} style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "4px 2px", flexShrink: 0,
            fontSize: 14, fontFamily: FONT, fontWeight: 400,
            color: C.zinc400, lineHeight: 1,
          }}>
            닫기
          </button>
        </div>

        {/* divider */}
        <div style={{ height: 1, background: C.zinc100, margin: "0 16px 0" }}/>

        {/* scrollable content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 16px 16px" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ─── Legend ──────────────────────────────────────────────────────── */
function LegendRow({ pk, desc }: { pk: PaletteKey; desc: string }) {
  const p = PALETTE[pk];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
      <div style={{ width: 8, height: 8, borderRadius: 2, background: p.accent, flexShrink: 0 }}/>
      <Badge pk={pk} />
      <span style={{ fontSize: 11, fontFamily: FONT, color: C.zinc500 }}>{desc}</span>
    </div>
  );
}

/* ─── Phone instance (self-contained state) ───────────────────────── */
function PhoneInstance({ initialMemoVisible }: { initialMemoVisible: boolean }) {
  const [memoVisible, setMemoVisible]   = useState(initialMemoVisible);
  const [aiSpinning, setAiSpinning]     = useState(false);
  const [selectedKw, setSelectedKw]     = useState<Set<string>>(new Set(["감정", "연결"]));
  const [blocks, setBlocks]             = useState({ summary: true, ai: true, keyword: true });

  function reroll() {
    if (aiSpinning) return;
    setAiSpinning(true);
    setTimeout(() => setAiSpinning(false), 450);
  }
  function toggleKw(kw: string) {
    setSelectedKw(prev => { const n = new Set(prev); n.has(kw) ? n.delete(kw) : n.add(kw); return n; });
  }
  function closeBlock(key: keyof typeof blocks) {
    setBlocks(prev => ({ ...prev, [key]: false }));
  }
  function addBlock() {
    setBlocks({ summary: true, ai: true, keyword: true });
    setSelectedKw(new Set(["감정", "연결"]));
  }

  return (
    <PhoneFrame
      memoVisible={memoVisible}
      onToggleMemo={() => setMemoVisible(v => !v)}
      onCloseMemo={() => setMemoVisible(false)}
    >
      {blocks.summary && <SummaryBlock onClose={() => closeBlock("summary")} />}
      {blocks.ai      && <AiBlock spinning={aiSpinning} onReroll={reroll} onClose={() => closeBlock("ai")} />}
      {blocks.keyword && <KeywordBlock selected={selectedKw} onToggle={toggleKw} onClose={() => closeBlock("keyword")} />}
      <AddBlockButton onClick={addBlock} />
      <FreeMemo />
    </PhoneFrame>
  );
}

/* ─── Main ────────────────────────────────────────────────────────── */
export function QuestionBlockPreview() {
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
        {/* page header */}
        <div style={{ textAlign: "center" }}>
          <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: "#27272a", letterSpacing: "-0.03em" }}>
            읽기 메모 · 질문 블록
          </h1>
          <p style={{ margin: "5px 0 0", fontSize: 11, color: C.zinc400 }}>
            눈 버튼으로 메모 토글 · × 로 블록 삭제 · 리롤 가능
          </p>
        </div>

        {/* two phone states side by side */}
        <div style={{ display: "flex", gap: 28, alignItems: "flex-start", flexWrap: "wrap", justifyContent: "center" }}>
          {/* Phone A — memo visible */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: C.white, borderRadius: 20, padding: "5px 12px",
              fontSize: 11, fontFamily: FONT, fontWeight: 600, color: C.zinc600,
              border: `1px solid ${C.zinc200}`,
            }}>
              <EyeIcon visible={true} />
              메모 보기
            </div>
            <PhoneInstance initialMemoVisible={true} />
          </div>

          {/* Phone B — memo hidden */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: C.white, borderRadius: 20, padding: "5px 12px",
              fontSize: 11, fontFamily: FONT, fontWeight: 600, color: C.zinc400,
              border: `1px solid ${C.zinc200}`,
            }}>
              <EyeIcon visible={false} />
              메모 숨기기
            </div>
            <PhoneInstance initialMemoVisible={false} />
          </div>
        </div>

        {/* legend */}
        <div style={{
          background: C.white, borderRadius: 14, padding: "16px 20px",
          border: `1px solid ${C.zinc200}`, width: "100%", maxWidth: 420,
        }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: C.zinc400, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 12 }}>
            배지 색상 의미
          </div>
          <LegendRow pk="summary" desc="요약 — 핵심 파악" />
          <LegendRow pk="ai"      desc="AI PICK / 직접입력 — Friction 고유색" />
          <LegendRow pk="emotion" desc="감정 / 연결 — 공감·관계 (보라)" />
          <LegendRow pk="change"  desc="변화 / 실천 — 행동·성장 (청록)" />
          <LegendRow pk="counter" desc="반론 / 궁금증 — 비판적 사고 (주황)" />
        </div>
      </div>
    </>
  );
}

export default QuestionBlockPreview;
