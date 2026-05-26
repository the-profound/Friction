import { useEffect, useState } from "react";

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

/** Pure SVG envelope with wax seal — no background image. */
function EnvelopeVisual({
  width = 280,
  height = 180,
  open = false,
  showSeal = true,
  sealRotate = -8,
}: {
  width?: number;
  height?: number;
  open?: boolean;
  showSeal?: boolean;
  sealRotate?: number;
}) {
  return (
    <div
      style={{
        width,
        height,
        position: "relative",
        perspective: 1200,
      }}
    >
      {/* Envelope back (always visible) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, #F4EFE4 0%, #E4DCC9 100%)",
          borderRadius: 6,
          boxShadow:
            "0 8px 24px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.10), inset 0 -2px 4px rgba(0,0,0,0.05)",
          overflow: "hidden",
        }}
      >
        {/* Inner darkness when opened (showing inside of envelope) */}
        {open && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: "60%",
              background:
                "linear-gradient(180deg, rgba(80,60,40,0.35) 0%, rgba(0,0,0,0) 100%)",
            }}
          />
        )}
      </div>

      {/* Envelope front panel (covers bottom portion, hides letter when closed) */}
      <div
        style={{
          position: "absolute",
          top: "42%",
          left: 0,
          right: 0,
          bottom: 0,
          background:
            "linear-gradient(180deg, #FBF7EE 0%, #EFE7D5 100%)",
          borderRadius: "0 0 6px 6px",
          boxShadow: "inset 0 2px 4px rgba(0,0,0,0.06)",
          zIndex: 4,
        }}
      >
        {/* Side diagonal seam (left) */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: "50%",
            background:
              "linear-gradient(135deg, transparent 49.4%, rgba(0,0,0,0.06) 49.7%, rgba(0,0,0,0.06) 50.3%, transparent 50.6%)",
          }}
        />
        {/* Side diagonal seam (right) */}
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: "50%",
            background:
              "linear-gradient(45deg, transparent 49.4%, rgba(0,0,0,0.06) 49.7%, rgba(0,0,0,0.06) 50.3%, transparent 50.6%)",
          }}
        />
      </div>

      {/* Envelope flap (the V at top — animates open) */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "60%",
          transformOrigin: "top center",
          transform: open ? "rotateX(-178deg)" : "rotateX(0deg)",
          transition: "transform 0.7s cubic-bezier(0.65, 0, 0.35, 1) 0.35s",
          transformStyle: "preserve-3d",
          zIndex: 5,
          backfaceVisibility: "visible",
        }}
      >
        <svg
          viewBox="0 0 280 168"
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            filter: open
              ? "drop-shadow(0 -4px 8px rgba(0,0,0,0.2))"
              : "none",
          }}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="flapFront" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FBF7EE" />
              <stop offset="100%" stopColor="#E8DFCB" />
            </linearGradient>
          </defs>
          {/* Triangular flap */}
          <polygon points="0,0 280,0 140,168" fill="url(#flapFront)" />
          {/* Fold lines */}
          <line
            x1="0"
            y1="0"
            x2="140"
            y2="168"
            stroke="rgba(0,0,0,0.08)"
            strokeWidth="1"
          />
          <line
            x1="280"
            y1="0"
            x2="140"
            y2="168"
            stroke="rgba(0,0,0,0.08)"
            strokeWidth="1"
          />
          {/* Subtle gradient on flap point */}
          <polygon
            points="60,72 220,72 140,168"
            fill="rgba(0,0,0,0.025)"
          />
        </svg>
      </div>

      {/* Wax seal — floats up & fades */}
      {showSeal && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 64,
            height: 64,
            marginLeft: -32,
            marginTop: -32,
            transform: open
              ? `translateY(-${Math.round(height * 0.85)}px) scale(1.5) rotate(${sealRotate - 25}deg)`
              : `translateY(0) scale(1) rotate(${sealRotate}deg)`,
            opacity: open ? 0 : 1,
            transition:
              "transform 0.9s cubic-bezier(0.34, 1.15, 0.64, 1), opacity 0.75s ease 0.15s",
            zIndex: 6,
            filter: "drop-shadow(0 3px 5px rgba(0,0,0,0.3))",
            pointerEvents: "none",
          }}
        >
          <WaxSealSvg />
        </div>
      )}
    </div>
  );
}

function WaxSealSvg() {
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%">
      <defs>
        <radialGradient id="seal-fill" cx="38%" cy="32%" r="68%">
          <stop offset="0%" stopColor="#A02A3A" />
          <stop offset="55%" stopColor="#7B1F2C" />
          <stop offset="100%" stopColor="#4A1019" />
        </radialGradient>
        <radialGradient id="seal-shine" cx="33%" cy="28%" r="45%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.30)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
      </defs>
      {/* Wax blob — slightly uneven scalloped edge */}
      <path
        d="M50,4 Q63,5 69,13 Q83,17 84,32 Q95,40 90,53 Q97,67 84,72 Q80,87 65,86 Q58,97 45,92 Q31,96 24,84 Q9,82 11,67 Q2,59 9,46 Q4,31 17,28 Q21,13 35,12 Q41,2 50,4 Z"
        fill="url(#seal-fill)"
      />
      <path
        d="M50,4 Q63,5 69,13 Q83,17 84,32 Q95,40 90,53 Q97,67 84,72 Q80,87 65,86 Q58,97 45,92 Q31,96 24,84 Q9,82 11,67 Q2,59 9,46 Q4,31 17,28 Q21,13 35,12 Q41,2 50,4 Z"
        fill="url(#seal-shine)"
      />
      {/* Inner ring */}
      <circle
        cx="50"
        cy="50"
        r="30"
        fill="none"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="1.2"
      />
      {/* Italic 'f' */}
      <text
        x="50"
        y="66"
        textAnchor="middle"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="44"
        fontStyle="italic"
        fill="rgba(252,240,220,0.95)"
        style={{ letterSpacing: "-1px" }}
      >
        f
      </text>
    </svg>
  );
}

function ClosedEnvelopeCard({
  env,
  onClick,
}: {
  env: typeof envelopes[0];
  onClick: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      style={{
        marginBottom: 18,
        cursor: "pointer",
        borderRadius: 12,
        padding: "20px 16px 16px",
        background: "#FFFFFF",
        boxShadow: pressed
          ? "0 2px 6px rgba(0,0,0,0.08)"
          : "0 2px 10px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)",
        border: "1px solid rgba(0,0,0,0.04)",
        transform: pressed ? "scale(0.985)" : "scale(1)",
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        position: "relative",
      }}
    >
      {/* Badges */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          display: "flex",
          gap: 6,
          zIndex: 10,
        }}
      >
        {env.isNotice && (
          <span
            style={{
              background: "#92323D",
              color: "white",
              fontSize: 10,
              fontFamily: "'Pretendard', sans-serif",
              fontWeight: 600,
              padding: "3px 9px",
              borderRadius: 20,
            }}
          >
            인사
          </span>
        )}
        {env.isReply && (
          <span
            style={{
              background: "#3a342d",
              color: "white",
              fontSize: 10,
              fontFamily: "'Pretendard', sans-serif",
              fontWeight: 500,
              padding: "3px 9px",
              borderRadius: 20,
            }}
          >
            답장
          </span>
        )}
      </div>

      {/* Unread dot */}
      <div
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: "#92323D",
        }}
      />

      {/* The envelope visual */}
      <EnvelopeVisual width={260} height={168} sealRotate={(env.id * 37) % 20 - 10} />

      {/* Sender info below */}
      <div
        style={{
          width: "100%",
          marginTop: 16,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <span
          style={{
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: 15,
            fontWeight: 600,
            color: "#1a1612",
            letterSpacing: "-0.01em",
          }}
        >
          {env.sender}
        </span>
        <span
          style={{
            fontFamily: "'Pretendard', sans-serif",
            fontSize: 11,
            color: "#9a9087",
          }}
        >
          {env.date}
        </span>
      </div>

      {env.collection && (
        <div style={{ width: "100%", marginTop: 6 }}>
          <span
            style={{
              display: "inline-block",
              fontSize: 10,
              fontFamily: "'Pretendard', sans-serif",
              color: "#6b6258",
              background: "#f0ebe2",
              padding: "2px 8px",
              borderRadius: 20,
            }}
          >
            {env.collection}
          </span>
        </div>
      )}
    </div>
  );
}

function OpenedLetter({
  env,
  onClose,
}: {
  env: typeof envelopes[0];
  onClose: () => void;
}) {
  // start closed visually, then flip to open after mount → triggers CSS transitions
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setOpen(true));
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const handleClose = () => {
    setClosing(true);
    setTimeout(onClose, 350);
  };

  return (
    <div
      onClick={handleClose}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(20,16,12,0.7)",
        backdropFilter: "blur(8px)",
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        opacity: closing ? 0 : 1,
        transition: "opacity 0.35s ease",
      }}
    >
      {/* Close button */}
      <div
        style={{
          height: 44,
          paddingTop: 14,
          paddingLeft: 20,
          paddingRight: 20,
          display: "flex",
          justifyContent: "flex-end",
          flexShrink: 0,
        }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleClose();
          }}
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
            opacity: open ? 1 : 0,
            transition: "opacity 0.3s ease 0.9s",
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#1a1612"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Stage */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: "0 24px",
          position: "relative",
        }}
      >
        {/* Envelope + letter container */}
        <div
          style={{
            width: 300,
            position: "relative",
          }}
        >
          {/* Letter — slides up from inside envelope */}
          <div
            style={{
              position: "absolute",
              left: 12,
              right: 12,
              bottom: 30,
              background: "#FBF8F1",
              borderRadius: 4,
              boxShadow: open
                ? "0 8px 24px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.14)"
                : "0 0 0 rgba(0,0,0,0)",
              padding: "22px 22px 20px",
              transform: open ? "translateY(-260px)" : "translateY(0)",
              opacity: open ? 1 : 0,
              transition:
                "transform 0.85s cubic-bezier(0.22, 0.61, 0.36, 1) 0.7s, opacity 0.45s ease 0.7s, box-shadow 0.5s ease 0.7s",
              zIndex: 3,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 14,
                paddingBottom: 10,
                borderBottom: "1px solid rgba(0,0,0,0.08)",
              }}
            >
              <span
                style={{
                  fontFamily: "Georgia, 'Times New Roman', serif",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#1a1612",
                }}
              >
                {env.sender}
              </span>
              <span
                style={{
                  fontFamily: "'Pretendard', sans-serif",
                  fontSize: 10,
                  color: "#9a9087",
                }}
              >
                {env.date}
              </span>
            </div>
            <h2
              style={{
                margin: "0 0 10px 0",
                fontFamily: "Georgia, 'Times New Roman', serif",
                fontSize: 18,
                fontWeight: 700,
                color: "#1a1612",
                letterSpacing: "-0.01em",
                lineHeight: 1.3,
              }}
            >
              {env.title}
            </h2>
            <p
              style={{
                margin: 0,
                fontFamily: "Georgia, 'Times New Roman', serif",
                fontSize: 12,
                color: "#3a342d",
                lineHeight: 1.7,
                whiteSpace: "pre-line",
              }}
            >
              {env.body}
            </p>
          </div>

          {/* Envelope (flap opens, seal floats up) */}
          <div style={{ position: "relative", zIndex: 4 }}>
            <EnvelopeVisual width={300} height={194} open={open} sealRotate={-8} />
          </div>
        </div>

        {env.collection && (
          <div
            style={{
              marginTop: 28,
              opacity: open ? 1 : 0,
              transition: "opacity 0.4s ease 1.2s",
            }}
          >
            <span
              style={{
                display: "inline-block",
                fontSize: 11,
                fontFamily: "'Pretendard', sans-serif",
                color: "rgba(255,255,255,0.9)",
                background: "rgba(255,255,255,0.15)",
                padding: "4px 12px",
                borderRadius: 20,
              }}
            >
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

  const openEnvelope = (id: number) => setActiveId(id);
  const closeEnvelope = () => setActiveId(null);

  const active = envelopes.find((e) => e.id === activeId);

  return (
    <div
      style={{
        width: 390,
        height: 844,
        background: "#F7F4EE",
        fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Status bar */}
      <div
        style={{
          height: 44,
          paddingTop: 14,
          paddingLeft: 20,
          paddingRight: 20,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "#1a1612" }}>
          9:41
        </span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <svg width="17" height="12" viewBox="0 0 17 12" fill="#1a1612">
            <rect x="0" y="3" width="3" height="9" rx="1" />
            <rect x="4.5" y="2" width="3" height="10" rx="1" />
            <rect x="9" y="0.5" width="3" height="11.5" rx="1" />
            <rect x="13.5" y="0" width="3" height="12" rx="1" opacity="0.3" />
          </svg>
          <div
            style={{
              width: 22,
              height: 11,
              border: "1.5px solid #1a1612",
              borderRadius: 3,
              position: "relative",
              display: "flex",
              alignItems: "center",
              padding: "0 1px",
            }}
          >
            <div
              style={{
                width: "75%",
                height: 7,
                background: "#1a1612",
                borderRadius: 1.5,
              }}
            />
            <div
              style={{
                position: "absolute",
                right: -4,
                top: "50%",
                transform: "translateY(-50%)",
                width: 2.5,
                height: 5,
                background: "#1a1612",
                borderRadius: 1,
              }}
            />
          </div>
        </div>
      </div>

      {/* Header */}
      <div
        style={{
          paddingLeft: 24,
          paddingRight: 20,
          paddingTop: 8,
          paddingBottom: 14,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          flexShrink: 0,
        }}
      >
        <div>
          <p
            style={{
              margin: 0,
              fontSize: 11,
              color: "#9a9087",
              letterSpacing: "0.04em",
              marginBottom: 3,
            }}
          >
            INBOX
          </p>
          <h1
            style={{
              margin: 0,
              fontSize: 26,
              fontWeight: 700,
              color: "#1a1612",
              letterSpacing: "-0.02em",
              fontFamily: "Georgia, 'Times New Roman', serif",
            }}
          >
            수신함
          </h1>
        </div>
        <button
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#4a4540"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      </div>

      {/* Unread count */}
      <div
        style={{
          paddingLeft: 24,
          paddingRight: 24,
          marginBottom: 14,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 12,
            color: "#92323D",
            fontWeight: 600,
          }}
        >
          읽지 않은 편지 {envelopes.length}통
        </span>
      </div>

      {/* Envelope list */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          paddingLeft: 20,
          paddingRight: 20,
          paddingBottom: 20,
        }}
      >
        {envelopes.map((env) => (
          <ClosedEnvelopeCard
            key={env.id}
            env={env}
            onClick={() => openEnvelope(env.id)}
          />
        ))}
      </div>

      {/* Tab bar */}
      <div
        style={{
          height: 83,
          background: "rgba(247,244,238,0.95)",
          backdropFilter: "blur(12px)",
          borderTop: "1px solid rgba(0,0,0,0.08)",
          display: "flex",
          alignItems: "flex-start",
          paddingTop: 10,
          flexShrink: 0,
        }}
      >
        {[
          { label: "수신함", active: true },
          { label: "기록함", active: false },
          { label: "편집", active: false },
          { label: "MY", active: false },
        ].map((tab) => (
          <div
            key={tab.label}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              cursor: "pointer",
            }}
          >
            <div style={{ width: 22, height: 22 }}>
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke={tab.active ? "#92323D" : "#b0a89e"}
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
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
            <span
              style={{
                fontSize: 10,
                color: tab.active ? "#92323D" : "#b0a89e",
                fontWeight: tab.active ? 600 : 400,
              }}
            >
              {tab.label}
            </span>
          </div>
        ))}
      </div>

      {active && <OpenedLetter env={active} onClose={closeEnvelope} />}
    </div>
  );
}
