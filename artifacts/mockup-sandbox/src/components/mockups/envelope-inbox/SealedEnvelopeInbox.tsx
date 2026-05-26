import { useState } from "react";

const ENVELOPE_IMG = "/__mockup/images/sealed-envelope.png";

const envelopes = [
  {
    id: 1,
    sender: "김서연",
    collection: "봄 편지 모음",
    date: "5월 26일",
    title: "비 오는 날의 단상",
    body: "오늘 창밖에 비가 내리고 있어요. 빗소리를 들으며 오래전 당신과 나누었던 대화를 떠올렸어요. 그때 우리는 무엇이든 될 수 있을 것 같았죠.\n\n시간이 흘러도 어떤 마음은 그대로 남는 것 같아요. 이 편지가 당신에게 닿을 즈음, 그곳에도 비가 내리고 있으면 좋겠어요.",
    isNotice: false,
    isReply: false,
  },
  {
    id: 2,
    sender: "운영진",
    collection: undefined,
    date: "5월 25일",
    title: "6월의 인사",
    body: "안녕하세요, Friction입니다.\n\n6월 한 달도 좋은 글로 함께해요. 이번 달에는 새로운 모음이 열립니다. 기대해 주세요.",
    isNotice: true,
    isReply: false,
  },
  {
    id: 3,
    sender: "이준호",
    collection: "여름의 기억",
    date: "5월 24일",
    title: "답장이 늦었어요",
    body: "답장이 늦었네요. 당신의 글을 읽고 또 읽었어요. 어떤 답을 해야 할지 한참을 고민했답니다.",
    isNotice: false,
    isReply: true,
  },
];

type Phase = "closed" | "opening" | "open" | "closing";

function ClosedEnvelopeCard({
  env,
  onClick,
}: {
  env: typeof envelopes[0];
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        position: "relative",
        marginBottom: 18,
        cursor: "pointer",
        borderRadius: 10,
        overflow: "hidden",
        boxShadow: "0 6px 18px rgba(0,0,0,0.14), 0 2px 5px rgba(0,0,0,0.08)",
        transition: "transform 0.18s ease, box-shadow 0.18s ease",
      }}
      onMouseDown={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform = "scale(0.98)";
      }}
      onMouseUp={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform = "scale(1)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform = "scale(1)";
      }}
    >
      <img
        src={ENVELOPE_IMG}
        alt="봉인된 편지"
        style={{
          width: "100%",
          aspectRatio: "1 / 1",
          objectFit: "cover",
          objectPosition: "center 45%",
          display: "block",
          transform: "scale(1.35) translateY(-2%)",
          transformOrigin: "center",
        }}
      />

      {/* Top-left badges overlay */}
      <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 6 }}>
        {env.isNotice && (
          <span style={{
            background: "rgba(255,255,255,0.95)",
            color: "#92323D",
            fontSize: 10,
            fontFamily: "'Pretendard', sans-serif",
            fontWeight: 600,
            padding: "3px 9px",
            borderRadius: 20,
            border: "1px solid rgba(146,50,61,0.18)",
          }}>
            인사
          </span>
        )}
        {env.isReply && (
          <span style={{
            background: "rgba(255,255,255,0.95)",
            color: "#444",
            fontSize: 10,
            fontFamily: "'Pretendard', sans-serif",
            fontWeight: 500,
            padding: "3px 9px",
            borderRadius: 20,
            border: "1px solid rgba(0,0,0,0.12)",
          }}>
            답장
          </span>
        )}
      </div>

      {/* Bottom-left info overlay */}
      <div style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        padding: "30px 16px 14px",
        background: "linear-gradient(to top, rgba(0,0,0,0.55), rgba(0,0,0,0))",
        color: "white",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}>
            {env.sender}
          </span>
          <span style={{
            fontFamily: "'Pretendard', sans-serif",
            fontSize: 11,
            opacity: 0.85,
          }}>
            {env.date}
          </span>
        </div>
        {env.collection && (
          <span style={{
            display: "inline-block",
            marginTop: 6,
            fontSize: 10,
            fontFamily: "'Pretendard', sans-serif",
            color: "rgba(255,255,255,0.85)",
            background: "rgba(255,255,255,0.18)",
            padding: "2px 8px",
            borderRadius: 20,
            backdropFilter: "blur(4px)",
          }}>
            {env.collection}
          </span>
        )}
      </div>
    </div>
  );
}

function OpenedLetter({
  env,
  phase,
  onClose,
}: {
  env: typeof envelopes[0];
  phase: Phase;
  onClose: () => void;
}) {
  // Animation timing controlled via phase
  // phase === "opening" → seal floats up & fades (0–600ms), envelope cracks (300–900ms), letter reveals (700–1200ms)
  // phase === "open"     → final resting state
  // phase === "closing"  → reverse fade out (0–350ms)

  const isAnimatingIn = phase === "opening";
  const isOpen = phase === "open" || phase === "opening";
  const isClosing = phase === "closing";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(20,16,12,0.55)",
        backdropFilter: "blur(6px)",
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        opacity: isClosing ? 0 : 1,
        transition: "opacity 0.35s ease",
      }}
    >
      {/* Close button */}
      <div style={{
        height: 44,
        paddingTop: 14,
        paddingLeft: 20,
        paddingRight: 20,
        display: "flex",
        justifyContent: "flex-end",
        flexShrink: 0,
        opacity: isOpen ? 1 : 0,
        transition: "opacity 0.3s ease 0.7s",
      }}>
        <button
          onClick={onClose}
          style={{
            background: "rgba(255,255,255,0.92)",
            border: "none",
            width: 32,
            height: 32,
            borderRadius: "50%",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 2px 6px rgba(0,0,0,0.18)",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1a1612" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Envelope stage */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: "0 24px",
        position: "relative",
      }}>
        {/* Envelope container */}
        <div style={{
          width: "100%",
          maxWidth: 320,
          aspectRatio: "1.55 / 1",
          position: "relative",
        }}>
          {/* Envelope back (always visible) */}
          <div style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #F8F4ED 0%, #ECE6D9 100%)",
            borderRadius: 6,
            boxShadow: "0 10px 30px rgba(0,0,0,0.35), 0 3px 8px rgba(0,0,0,0.2)",
            overflow: "hidden",
          }}>
            {/* Inner shadow giving depth */}
            <div style={{
              position: "absolute",
              inset: 0,
              boxShadow: "inset 0 2px 6px rgba(0,0,0,0.08)",
              pointerEvents: "none",
            }} />
          </div>

          {/* Letter sliding out */}
          <div style={{
            position: "absolute",
            left: "8%",
            right: "8%",
            top: isOpen ? "-58%" : "8%",
            bottom: isOpen ? "auto" : "8%",
            height: isOpen ? "auto" : undefined,
            background: "#FBF8F1",
            borderRadius: 4,
            boxShadow: isOpen
              ? "0 8px 24px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.12)"
              : "0 1px 3px rgba(0,0,0,0.05)",
            padding: isOpen ? "22px 22px 20px" : "0",
            opacity: isOpen ? 1 : 0,
            transition: isAnimatingIn
              ? "top 0.7s cubic-bezier(0.22, 0.61, 0.36, 1) 0.55s, opacity 0.4s ease 0.55s, box-shadow 0.4s ease 0.55s, padding 0.5s ease 0.55s"
              : "all 0.3s ease",
            overflow: "hidden",
            zIndex: 3,
          }}>
            {isOpen && (
              <>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 14,
                  paddingBottom: 10,
                  borderBottom: "1px solid rgba(0,0,0,0.08)",
                }}>
                  <span style={{
                    fontFamily: "Georgia, 'Times New Roman', serif",
                    fontSize: 14,
                    fontWeight: 600,
                    color: "#1a1612",
                  }}>
                    {env.sender}
                  </span>
                  <span style={{
                    fontFamily: "'Pretendard', sans-serif",
                    fontSize: 10,
                    color: "#9a9087",
                  }}>
                    {env.date}
                  </span>
                </div>
                <h2 style={{
                  margin: "0 0 10px 0",
                  fontFamily: "Georgia, 'Times New Roman', serif",
                  fontSize: 18,
                  fontWeight: 700,
                  color: "#1a1612",
                  letterSpacing: "-0.01em",
                  lineHeight: 1.3,
                }}>
                  {env.title}
                </h2>
                <p style={{
                  margin: 0,
                  fontFamily: "Georgia, 'Times New Roman', serif",
                  fontSize: 12,
                  color: "#3a342d",
                  lineHeight: 1.7,
                  whiteSpace: "pre-line",
                }}>
                  {env.body}
                </p>
              </>
            )}
          </div>

          {/* Envelope front body */}
          <div style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #FAF6EE 0%, #F0EADE 100%)",
            borderRadius: 6,
            top: "42%",
            zIndex: 4,
            boxShadow: "inset 0 4px 8px rgba(0,0,0,0.06)",
          }} />

          {/* Envelope flap (animates open) */}
          <div style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "60%",
            transformOrigin: "top center",
            transform: isOpen ? "rotateX(-175deg)" : "rotateX(0deg)",
            transition: isAnimatingIn
              ? "transform 0.6s cubic-bezier(0.65, 0, 0.35, 1) 0.35s"
              : "transform 0.3s ease",
            transformStyle: "preserve-3d",
            zIndex: 5,
          }}>
            <svg viewBox="0 0 320 192" style={{ width: "100%", height: "100%", display: "block" }} preserveAspectRatio="none">
              <defs>
                <linearGradient id="flapGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#F8F4ED" />
                  <stop offset="100%" stopColor="#E8E2D4" />
                </linearGradient>
                <linearGradient id="flapBack" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ECE6D9" />
                  <stop offset="100%" stopColor="#D8D1C0" />
                </linearGradient>
              </defs>
              {/* Flap shape (V) */}
              <polygon points="0,0 320,0 160,192" fill="url(#flapGrad)" />
              <line x1="0" y1="0" x2="160" y2="192" stroke="rgba(0,0,0,0.07)" strokeWidth="1" />
              <line x1="320" y1="0" x2="160" y2="192" stroke="rgba(0,0,0,0.07)" strokeWidth="1" />
              {/* Subtle fold shadow */}
              <polygon points="0,0 320,0 160,192" fill="url(#flapBack)" opacity={isOpen ? 0.6 : 0} style={{ transition: "opacity 0.4s ease" }} />
            </svg>
          </div>

          {/* Wax seal — floats up and fades */}
          <div style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 88,
            height: 88,
            marginLeft: -44,
            marginTop: -44,
            transform: isOpen
              ? "translateY(-260px) scale(1.6) rotate(-12deg)"
              : "translateY(0) scale(1) rotate(-5deg)",
            opacity: isOpen ? 0 : 1,
            transition: isAnimatingIn
              ? "transform 0.85s cubic-bezier(0.34, 1.2, 0.64, 1), opacity 0.7s ease 0.15s"
              : "all 0.3s ease",
            zIndex: 6,
            filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.35))",
            pointerEvents: "none",
          }}>
            <svg viewBox="0 0 100 100" width="100%" height="100%">
              <defs>
                <radialGradient id="sealGrad2" cx="38%" cy="32%" r="68%">
                  <stop offset="0%" stopColor="#A02A3A" />
                  <stop offset="55%" stopColor="#7B1F2C" />
                  <stop offset="100%" stopColor="#4A1019" />
                </radialGradient>
                <radialGradient id="sealShine2" cx="33%" cy="28%" r="45%">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.28)" />
                  <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                </radialGradient>
              </defs>
              {/* Wax blob with uneven edge */}
              <path
                d="M50,4 Q62,6 68,14 Q82,18 84,32 Q94,40 90,52 Q96,66 84,72 Q80,86 66,86 Q58,96 46,92 Q32,96 24,84 Q10,82 10,68 Q2,58 8,46 Q4,32 16,28 Q20,14 34,12 Q40,2 50,4 Z"
                fill="url(#sealGrad2)"
              />
              <path
                d="M50,4 Q62,6 68,14 Q82,18 84,32 Q94,40 90,52 Q96,66 84,72 Q80,86 66,86 Q58,96 46,92 Q32,96 24,84 Q10,82 10,68 Q2,58 8,46 Q4,32 16,28 Q20,14 34,12 Q40,2 50,4 Z"
                fill="url(#sealShine2)"
              />
              {/* Inner circle */}
              <circle cx="50" cy="50" r="32" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
              {/* Stylized 'f' */}
              <text
                x="50"
                y="65"
                textAnchor="middle"
                fontFamily="Georgia, 'Times New Roman', serif"
                fontSize="42"
                fontStyle="italic"
                fill="rgba(252,240,220,0.95)"
                style={{ letterSpacing: "-1px" }}
              >
                f
              </text>
            </svg>
          </div>

          {/* Envelope hint hint - "탭하여 열기" */}
          {phase === "closed" && (
            <div style={{
              position: "absolute",
              bottom: -34,
              left: 0,
              right: 0,
              textAlign: "center",
              color: "rgba(255,255,255,0.7)",
              fontSize: 11,
              fontFamily: "'Pretendard', sans-serif",
              letterSpacing: "0.05em",
            }}>
              탭하여 열기
            </div>
          )}
        </div>

        {/* Collection tag below envelope */}
        {env.collection && isOpen && (
          <div style={{
            marginTop: 36,
            opacity: isOpen ? 1 : 0,
            transition: "opacity 0.3s ease 1.0s",
          }}>
            <span style={{
              display: "inline-block",
              fontSize: 11,
              fontFamily: "'Pretendard', sans-serif",
              color: "rgba(255,255,255,0.85)",
              background: "rgba(255,255,255,0.15)",
              padding: "4px 12px",
              borderRadius: 20,
              backdropFilter: "blur(6px)",
            }}>
              {env.collection}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function SealedEnvelopeInbox() {
  const [activeId, setActiveId] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("closed");

  const openEnvelope = (id: number) => {
    setActiveId(id);
    setPhase("opening");
    // Settle into "open" after animation completes
    setTimeout(() => setPhase("open"), 1300);
  };

  const closeEnvelope = () => {
    setPhase("closing");
    setTimeout(() => {
      setActiveId(null);
      setPhase("closed");
    }, 350);
  };

  const active = envelopes.find((e) => e.id === activeId);

  return (
    <div style={{
      width: 390,
      height: 844,
      background: "#F7F4EE",
      fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      position: "relative",
    }}>
      {/* Status bar */}
      <div style={{
        height: 44,
        paddingTop: 14,
        paddingLeft: 20,
        paddingRight: 20,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#1a1612" }}>9:41</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <svg width="17" height="12" viewBox="0 0 17 12" fill="#1a1612">
            <rect x="0" y="3" width="3" height="9" rx="1" />
            <rect x="4.5" y="2" width="3" height="10" rx="1" />
            <rect x="9" y="0.5" width="3" height="11.5" rx="1" />
            <rect x="13.5" y="0" width="3" height="12" rx="1" opacity="0.3" />
          </svg>
          <div style={{ width: 22, height: 11, border: "1.5px solid #1a1612", borderRadius: 3, position: "relative", display: "flex", alignItems: "center", padding: "0 1px" }}>
            <div style={{ width: "75%", height: 7, background: "#1a1612", borderRadius: 1.5 }} />
            <div style={{ position: "absolute", right: -4, top: "50%", transform: "translateY(-50%)", width: 2.5, height: 5, background: "#1a1612", borderRadius: 1 }} />
          </div>
        </div>
      </div>

      {/* Header */}
      <div style={{
        paddingLeft: 24,
        paddingRight: 20,
        paddingTop: 8,
        paddingBottom: 14,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
        flexShrink: 0,
      }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, color: "#9a9087", letterSpacing: "0.04em", marginBottom: 3 }}>
            INBOX
          </p>
          <h1 style={{
            margin: 0,
            fontSize: 26,
            fontWeight: 700,
            color: "#1a1612",
            letterSpacing: "-0.02em",
            fontFamily: "Georgia, 'Times New Roman', serif",
          }}>
            수신함
          </h1>
        </div>
        <button style={{ background: "none", border: "none", cursor: "pointer", padding: 4, paddingBottom: 4 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4a4540" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      </div>

      {/* Unread count */}
      <div style={{
        paddingLeft: 24,
        paddingRight: 24,
        marginBottom: 14,
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: 12,
          color: "#92323D",
          fontWeight: 600,
        }}>
          읽지 않은 편지 {envelopes.length}통
        </span>
      </div>

      {/* Envelope list */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        paddingLeft: 20,
        paddingRight: 20,
        paddingBottom: 20,
      }}>
        {envelopes.map((env) => (
          <ClosedEnvelopeCard
            key={env.id}
            env={env}
            onClick={() => openEnvelope(env.id)}
          />
        ))}
      </div>

      {/* Tab bar */}
      <div style={{
        height: 83,
        background: "rgba(247,244,238,0.95)",
        backdropFilter: "blur(12px)",
        borderTop: "1px solid rgba(0,0,0,0.08)",
        display: "flex",
        alignItems: "flex-start",
        paddingTop: 10,
        flexShrink: 0,
      }}>
        {[
          { label: "수신함", active: true },
          { label: "기록함", active: false },
          { label: "편집", active: false },
          { label: "MY", active: false },
        ].map((tab) => (
          <div key={tab.label} style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            cursor: "pointer",
          }}>
            <div style={{ width: 22, height: 22 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={tab.active ? "#92323D" : "#b0a89e"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {tab.label === "수신함" && (
                  <>
                    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                    <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
                  </>
                )}
                {tab.label === "기록함" && (
                  <>
                    <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
                    <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
                  </>
                )}
                {tab.label === "편집" && (
                  <>
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </>
                )}
                {tab.label === "MY" && (
                  <>
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </>
                )}
              </svg>
            </div>
            <span style={{
              fontSize: 10,
              color: tab.active ? "#92323D" : "#b0a89e",
              fontWeight: tab.active ? 600 : 400,
            }}>
              {tab.label}
            </span>
          </div>
        ))}
      </div>

      {/* Opened letter overlay */}
      {active && (
        <OpenedLetter env={active} phase={phase} onClose={closeEnvelope} />
      )}
    </div>
  );
}
