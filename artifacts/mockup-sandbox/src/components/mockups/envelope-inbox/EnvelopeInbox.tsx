import { useState } from "react";

const envelopes = [
  {
    id: 1,
    sender: "김서연",
    collection: "봄 편지 모음",
    date: "5월 26일",
    preview: "오늘 창밖에 비가 내리고 있어요. 당신에게 이 글을 쓰고 싶었어요.",
    isUnread: true,
    isNotice: false,
    isReply: false,
    paperColor: "#F4EFE4",
    sealRotate: -8,
  },
  {
    id: 2,
    sender: "운영진",
    collection: undefined,
    date: "5월 25일",
    preview: "6월 인사 안내드립니다. 이번 달도 좋은 글로 함께해요.",
    isUnread: true,
    isNotice: true,
    isReply: false,
    paperColor: "#EEE9E0",
    sealRotate: 5,
  },
  {
    id: 3,
    sender: "이준호",
    collection: "여름의 기억",
    date: "5월 24일",
    preview: "답장이 늦었네요. 읽고 또 읽었어요.",
    isUnread: true,
    isNotice: false,
    isReply: true,
    paperColor: "#F0EBE0",
    sealRotate: -3,
  },
  {
    id: 4,
    sender: "박지원",
    collection: "일상 속 단상",
    date: "5월 22일",
    preview: "당신이 쓴 글을 읽으며 오래 생각했어요.",
    isUnread: false,
    isNotice: false,
    isReply: false,
    paperColor: "#EDE8DC",
    sealRotate: 7,
  },
  {
    id: 5,
    sender: "최아름",
    collection: "밤의 편지",
    date: "5월 20일",
    preview: "오늘 밤은 유난히 길게 느껴졌어요.",
    isUnread: false,
    isNotice: false,
    isReply: false,
    paperColor: "#EAE5D9",
    sealRotate: -5,
  },
];

function WaxSeal({ size = 64, rotate = 0 }: { size?: number; rotate?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        position: "relative",
        flexShrink: 0,
        transform: `rotate(${rotate}deg)`,
        filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.22))",
      }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <defs>
          <radialGradient id="sealGrad" cx="40%" cy="35%" r="65%">
            <stop offset="0%" stopColor="#8B2535" />
            <stop offset="60%" stopColor="#6B1D2A" />
            <stop offset="100%" stopColor="#4A1019" />
          </radialGradient>
          <radialGradient id="sealShine" cx="35%" cy="30%" r="50%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="47" fill="url(#sealGrad)" />
        <circle cx="50" cy="50" r="47" fill="url(#sealShine)" />
        <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="0.8" />
        {/* Decorative rim dots */}
        {Array.from({ length: 24 }).map((_, i) => {
          const angle = (i / 24) * 2 * Math.PI;
          const r = 44;
          const x = 50 + r * Math.cos(angle);
          const y = 50 + r * Math.sin(angle);
          return <circle key={i} cx={x} cy={y} r="0.9" fill="rgba(255,255,255,0.2)" />;
        })}
        {/* Stylized 'f' mark — Friction logo */}
        <text
          x="50"
          y="63"
          textAnchor="middle"
          fontFamily="Georgia, 'Times New Roman', serif"
          fontSize="40"
          fontWeight="400"
          fontStyle="italic"
          fill="rgba(255,255,255,0.92)"
          style={{ letterSpacing: "-1px" }}
        >
          f
        </text>
        {/* subtle inner glow */}
        <circle cx="50" cy="50" r="47" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="2" />
      </svg>
    </div>
  );
}

function EnvelopeFlap({ color }: { color: string }) {
  return (
    <svg
      viewBox="0 0 320 90"
      style={{ width: "100%", height: 90, display: "block", marginBottom: -1 }}
      preserveAspectRatio="none"
    >
      <polygon
        points="0,0 320,0 160,90"
        fill={color}
        style={{ filter: "brightness(0.93)" }}
      />
      <line x1="0" y1="0" x2="160" y2="90" stroke="rgba(0,0,0,0.06)" strokeWidth="0.8" />
      <line x1="320" y1="0" x2="160" y2="90" stroke="rgba(0,0,0,0.06)" strokeWidth="0.8" />
    </svg>
  );
}

function EnvelopeCard({ env }: { env: typeof envelopes[0] }) {
  const [pressed, setPressed] = useState(false);
  const opacity = env.isUnread ? 1 : 0.55;

  return (
    <div
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      style={{
        marginBottom: 16,
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: pressed
          ? "0 1px 6px rgba(0,0,0,0.12)"
          : "0 3px 12px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.07)",
        transform: pressed ? "scale(0.985)" : "scale(1)",
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
        cursor: "pointer",
        opacity,
        position: "relative",
        border: "1px solid rgba(0,0,0,0.05)",
      }}
    >
      {/* Envelope flap top */}
      <div style={{ background: env.paperColor, position: "relative" }}>
        <EnvelopeFlap color={env.paperColor} />

        {/* Badges on flap */}
        <div style={{ position: "absolute", top: 10, left: 14, display: "flex", gap: 6 }}>
          {env.isNotice && (
            <span style={{
              background: "rgba(255,255,255,0.9)",
              color: "#92323D",
              fontSize: 10,
              fontFamily: "'Pretendard', sans-serif",
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 20,
              border: "1px solid rgba(146,50,61,0.2)",
              letterSpacing: "0.02em",
            }}>
              인사
            </span>
          )}
          {env.isReply && (
            <span style={{
              background: "rgba(255,255,255,0.9)",
              color: "#444",
              fontSize: 10,
              fontFamily: "'Pretendard', sans-serif",
              fontWeight: 500,
              padding: "2px 8px",
              borderRadius: 20,
              border: "1px solid rgba(0,0,0,0.12)",
            }}>
              답장
            </span>
          )}
        </div>

        {/* Unread dot */}
        {env.isUnread && (
          <div style={{
            position: "absolute",
            top: 10,
            right: 14,
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "#92323D",
          }} />
        )}
      </div>

      {/* Envelope body */}
      <div style={{
        background: env.paperColor,
        padding: "0 20px 18px",
        display: "flex",
        alignItems: "center",
        gap: 18,
        position: "relative",
      }}>
        {/* Left border lines (envelope side) */}
        <div style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 6,
          background: "linear-gradient(to right, rgba(0,0,0,0.05), transparent)",
        }} />
        <div style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: 6,
          background: "linear-gradient(to left, rgba(0,0,0,0.05), transparent)",
        }} />

        {/* Wax Seal */}
        <div style={{ flexShrink: 0 }}>
          <WaxSeal size={62} rotate={env.sealRotate} />
        </div>

        {/* Letter info */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
            <span style={{
              fontFamily: "Georgia, 'Times New Roman', serif",
              fontSize: 15,
              fontWeight: env.isUnread ? 700 : 400,
              color: "#1a1612",
              letterSpacing: "-0.01em",
            }}>
              {env.sender}
            </span>
            <span style={{
              fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif",
              fontSize: 11,
              color: "#9a9087",
            }}>
              {env.date}
            </span>
          </div>

          <p style={{
            margin: 0,
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: 12.5,
            color: "#5a5148",
            lineHeight: 1.55,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            marginBottom: env.collection ? 8 : 0,
          }}>
            {env.preview}
          </p>

          {env.collection && (
            <span style={{
              display: "inline-block",
              background: "rgba(0,0,0,0.06)",
              color: "#6b6258",
              fontSize: 10,
              fontFamily: "'Pretendard', sans-serif",
              padding: "2px 8px",
              borderRadius: 20,
              marginTop: 2,
            }}>
              {env.collection}
            </span>
          )}
        </div>
      </div>

      {/* Bottom envelope fold line */}
      <div style={{ background: env.paperColor, position: "relative", overflow: "hidden" }}>
        <svg viewBox="0 0 320 28" style={{ width: "100%", height: 28, display: "block" }} preserveAspectRatio="none">
          <polygon points="0,28 320,28 160,0" fill={env.paperColor} style={{ filter: "brightness(0.91)" }} />
          <line x1="0" y1="28" x2="160" y2="0" stroke="rgba(0,0,0,0.055)" strokeWidth="0.7" />
          <line x1="320" y1="28" x2="160" y2="0" stroke="rgba(0,0,0,0.055)" strokeWidth="0.7" />
        </svg>
      </div>
    </div>
  );
}

export function EnvelopeInbox() {
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
          <svg width="16" height="12" viewBox="0 0 16 12" fill="#1a1612">
            <path d="M8 2.5C10.2 2.5 12.2 3.4 13.6 4.9L15 3.5C13.2 1.7 10.7 0.5 8 0.5C5.3 0.5 2.8 1.7 1 3.5L2.4 4.9C3.8 3.4 5.8 2.5 8 2.5Z" />
            <path d="M8 6C9.4 6 10.7 6.6 11.6 7.5L13 6.1C11.7 4.8 9.9 4 8 4C6.1 4 4.3 4.8 3 6.1L4.4 7.5C5.3 6.6 6.6 6 8 6Z" />
            <circle cx="8" cy="10.5" r="1.5" />
          </svg>
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <div style={{ width: 22, height: 11, border: "1.5px solid #1a1612", borderRadius: 3, position: "relative", display: "flex", alignItems: "center", padding: "0 1px" }}>
              <div style={{ width: "75%", height: 7, background: "#1a1612", borderRadius: 1.5 }} />
              <div style={{ position: "absolute", right: -4, top: "50%", transform: "translateY(-50%)", width: 2.5, height: 5, background: "#1a1612", borderRadius: 1 }} />
            </div>
          </div>
        </div>
      </div>

      {/* Header */}
      <div style={{
        paddingLeft: 24,
        paddingRight: 20,
        paddingTop: 8,
        paddingBottom: 12,
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
        <div style={{ display: "flex", gap: 12, paddingBottom: 4 }}>
          <button style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4a4540" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
        </div>
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
          letterSpacing: "0.01em",
        }}>
          읽지 않은 편지 3통
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
          <EnvelopeCard key={env.id} env={env} />
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
          { label: "수신함", icon: "inbox", active: true },
          { label: "기록함", icon: "book", active: false },
          { label: "편집", icon: "edit", active: false },
          { label: "MY", icon: "user", active: false },
        ].map((tab) => (
          <div key={tab.label} style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            cursor: "pointer",
          }}>
            <div style={{
              width: 24,
              height: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
              {tab.icon === "inbox" && (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={tab.active ? "#92323D" : "#b0a89e"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                  <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
                </svg>
              )}
              {tab.icon === "book" && (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={tab.active ? "#92323D" : "#b0a89e"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
                </svg>
              )}
              {tab.icon === "edit" && (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={tab.active ? "#92323D" : "#b0a89e"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              )}
              {tab.icon === "user" && (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={tab.active ? "#92323D" : "#b0a89e"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              )}
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
    </div>
  );
}
