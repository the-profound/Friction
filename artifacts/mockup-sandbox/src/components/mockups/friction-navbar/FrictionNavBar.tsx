import { useEffect, useRef, useState } from "react";
import waxSealUrl from "@/assets/wax-seal.png";

/* ─── Tokens ─────────────────────────────────────────────────── */
const C = {
  zinc900: "#18181b", zinc800: "#27272a", zinc700: "#3f3f46",
  zinc600: "#52525b", zinc500: "#71717a", zinc400: "#a1a1aa",
  zinc300: "#d4d4d8", zinc200: "#e4e4e7", zinc100: "#f4f4f5",
  zinc50:  "#fafafa", white: "#FFFFFF",
  navBarBg: "#FFFFFF", navBarBorder: "rgba(0,0,0,0.06)",
  tabActive: "#18181b", tabInactive: "#d4d4d8", tabInactiveAlt: "#a1a1aa",
  noticeAccent: "#92323D",
  dotActive: "#18181b", dotInactive: "#d4d4d8", dotEdge: "rgba(0,0,0,0.08)",
};

const SCREEN_W = 393;
const SCREEN_H = 852;

const CARD_W        = 300;
const CARD_H        = CARD_W * (8 / 5); // 480
const CARD_GAP      = 12;
const SNAP_INTERVAL = CARD_W + CARD_GAP; // 312
const CENTER_OFFSET = (SCREEN_W - CARD_W) / 2; // 46.5

const TITLE_SIZE  = 36;
const AUTHOR_SIZE = (4.5 / 100) * CARD_W;   // 13.5

const NAV_W  = 300;
const NAV_H  = 68;
const SAFE_BOTTOM = 34;
const NAV_BOTTOM  = SAFE_BOTTOM + 20;
const FAB_SIZE    = 52;
const FAB_BOTTOM  = NAV_BOTTOM + 8;
const STATUS_H    = 44; // mock status-bar height

const EXP_W   = SCREEN_W;                        // full screen width when expanded
const EXP_H   = EXP_W * (CARD_H / CARD_W);      // ~578 — proportional height
const EXP_TOP = STATUS_H + 12;                   // 56px — just below status bar

/* ─── Tabs ───────────────────────────────────────────────────── */
const TABS = [
  { key: "IN", label: "수신",  icon: "inbox"     },
  { key: "SR", label: "연재",  icon: "book-open" },
  { key: "ON", label: "기록",  icon: "edit-3"    },
  { key: "MO", label: "모임",  icon: "share-2"   },
  { key: "MY", label: "마이",  icon: "user"      },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/* ─── Mock inbox data ─────────────────────────────────────────── */
interface MockCard {
  id: string;
  author: string;
  title: string;
  bg: string;
  textColor: string;
  image?: string;
  collection?: string;
  isNotice?: boolean;
  isReply?: boolean;
}
interface MockGroup { date: string; cards: MockCard[] }

const MOCK_GROUPS: MockGroup[] = [
  {
    date: "5월 28일",
    cards: [
      {
        id: "g1c1",
        author: "운영진",
        title: "5월의 인사",
        bg: C.zinc50,
        textColor: C.zinc900,
        isNotice: true,
      },
      {
        id: "g1c2",
        author: "김서연",
        title: "비 오는 날의 단상",
        bg: "#1c1814",
        textColor: "#f5f0e8",
        image: "https://images.unsplash.com/photo-1534088568595-a066f410bcda?w=600&q=80",
        collection: "봄 편지 모음",
      },
      {
        id: "g1c3",
        author: "이준호",
        title: "답장이 늦었어요",
        bg: "#1a1612",
        textColor: "#f0ebe0",
        isReply: true,
      },
    ],
  },
  {
    date: "5월 26일",
    cards: [
      {
        id: "g2c1",
        author: "박민준",
        title: "서울의 밤",
        bg: "#0d1117",
        textColor: "#e8edf5",
        image: "https://images.unsplash.com/photo-1538485399081-7191377e8241?w=600&q=80",
      },
      {
        id: "g2c2",
        author: "최유진",
        title: "책 한 권의 무게",
        bg: C.zinc50,
        textColor: C.zinc900,
        collection: "독서 노트",
      },
    ],
  },
  {
    date: "5월 24일",
    cards: [
      {
        id: "g3c1",
        author: "정다은",
        title: "오래된 카페에서",
        bg: "#1a1008",
        textColor: "#f5ede8",
        image: "https://images.unsplash.com/photo-1445116572660-236099ec97a0?w=600&q=80",
      },
    ],
  },
];

/* ─── Feather icons ───────────────────────────────────────────── */
function Icon({ name, size, color }: { name: string; size: number; color: string }) {
  const s: React.CSSProperties = { width: size, height: size, display: "block", flexShrink: 0 };
  const p = { fill: "none", stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "inbox":
      return <svg viewBox="0 0 24 24" style={s} {...p}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>;
    case "book-open":
      return <svg viewBox="0 0 24 24" style={s} {...p}><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>;
    case "edit-3":
      return <svg viewBox="0 0 24 24" style={s} {...p}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>;
    case "edit":
      return <svg viewBox="0 0 24 24" style={s} {...p}><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
    case "users":
      return <svg viewBox="0 0 24 24" style={s} {...p}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>;
    case "user":
      return <svg viewBox="0 0 24 24" style={s} {...p}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
    case "share-2":
      return <svg viewBox="0 0 24 24" style={s} {...p}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>;
    case "search":
      return <svg viewBox="0 0 24 24" style={s} {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
    default:
      return null;
  }
}

/* ─── Article card ────────────────────────────────────────────── */
function ArticleCard({
  card,
  isActive,
}: {
  card: MockCard;
  isActive: boolean;
}) {
  return (
    <div
      style={{
        width: CARD_W,
        height: CARD_H,
        borderRadius: 16,
        overflow: "hidden",
        background: card.bg,
        position: "relative",
        flexShrink: 0,
        opacity: isActive ? 1 : 0.55,
        transform: isActive ? "scale(1)" : "scale(0.97)",
        transition: "opacity 0.22s ease, transform 0.22s ease",
      }}
    >
      {/* Photo background */}
      {card.image && (
        <img
          src={card.image}
          alt=""
          style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%",
            objectFit: "cover", objectPosition: "center",
            display: "block",
          }}
        />
      )}
      {/* Gradient overlay — only on photo cards */}
      {card.image && (
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(160deg, rgba(0,0,0,0.52) 0%, rgba(0,0,0,0.18) 55%, rgba(0,0,0,0.44) 100%)",
        }} />
      )}

      {/* Text content — top-left: title → author → collection */}
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column", justifyContent: "flex-start",
        padding: 24,
      }}>
        <span style={{
          fontSize: TITLE_SIZE,
          lineHeight: `${TITLE_SIZE * 1.25}px`,
          fontFamily: "'Noto Sans KR', sans-serif",
          fontWeight: 700,
          color: card.textColor,
          letterSpacing: `${-0.02 * TITLE_SIZE}px`,
          WebkitLineClamp: 5,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          marginBottom: 10,
        } as React.CSSProperties}>
          {card.title}
        </span>
        <span style={{
          display: "block",
          fontSize: AUTHOR_SIZE,
          lineHeight: `${AUTHOR_SIZE * 1.6}px`,
          fontFamily: "'Noto Sans KR', sans-serif",
          fontWeight: 400,
          color: card.textColor,
          opacity: 0.75,
        }}>
          {card.author}
        </span>
        {card.collection && (
          <span style={{
            display: "block",
            fontSize: AUTHOR_SIZE * 0.85,
            lineHeight: `${AUTHOR_SIZE * 1.5}px`,
            fontFamily: "'Noto Sans KR', sans-serif",
            fontWeight: 300,
            color: card.textColor,
            opacity: 0.5,
            marginTop: 3,
          }}>
            {card.collection}
          </span>
        )}
      </div>

      {/* Badges — bottom-right */}
      {(card.isNotice || card.isReply) && (
        <div style={{ position: "absolute", bottom: 12, right: 12, display: "flex", flexDirection: "column", gap: 4, zIndex: 2, alignItems: "flex-end" }}>
          {card.isNotice && (
            <span style={{
              background: C.white, color: C.noticeAccent,
              fontSize: 12, fontWeight: 600, fontFamily: "'Noto Sans KR', sans-serif",
              padding: "4px 10px", borderRadius: 999,
            }}>인사</span>
          )}
          {card.isReply && (
            <span style={{
              background: C.white, color: C.zinc900,
              fontSize: 12, fontWeight: 600, fontFamily: "'Noto Sans KR', sans-serif",
              padding: "4px 10px", borderRadius: 4,
            }}>답장</span>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Dot indicator ───────────────────────────────────────────── */
function DotIndicator({ total, activeIndex }: { total: number; activeIndex: number }) {
  if (total <= 1) return <div style={{ height: 36 }} />;
  return (
    <div style={{ height: 36, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
      {Array.from({ length: Math.min(total, 7) }, (_, i) => {
        const isActive = i === activeIndex;
        return (
          <div
            key={i}
            style={{
              borderRadius: 999,
              background: isActive ? C.dotActive : C.dotInactive,
              width:  isActive ? 18 : 6,
              height: isActive ? 6  : 6,
              transition: "width 0.2s ease, background 0.2s ease",
            }}
          />
        );
      })}
    </div>
  );
}

/* ─── Carousel group ──────────────────────────────────────────── */
function CarouselGroup({
  group,
  onCardTap,
  hiddenCardId,
}: {
  group: MockGroup;
  onCardTap?: (card: MockCard, element: HTMLElement | null) => void;
  hiddenCardId?: string | null;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const translateX = useRef(getBaseX(0));
  const trackRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  const dragState = useRef<{ startX: number; startTX: number; dragging: boolean; isDown: boolean }>({
    startX: 0, startTX: 0, dragging: false, isDown: false,
  });

  function getBaseX(idx: number) {
    return -(idx * SNAP_INTERVAL) + CENTER_OFFSET;
  }

  function snapTo(idx: number) {
    const clamped = Math.max(0, Math.min(idx, group.cards.length - 1));
    translateX.current = getBaseX(clamped);
    setActiveIndex(clamped);
    if (trackRef.current) {
      trackRef.current.style.transition = "transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)";
      trackRef.current.style.transform = `translateX(${translateX.current}px)`;
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startTX: translateX.current, dragging: false, isDown: true };
    if (trackRef.current) trackRef.current.style.transition = "none";
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragState.current.isDown) return;
    const { startX, startTX } = dragState.current;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 5) dragState.current.dragging = true;
    if (!dragState.current.dragging) return;
    const minX = getBaseX(group.cards.length - 1);
    const maxX = getBaseX(0);
    const raw = startTX + dx;
    const rubber = raw > maxX ? maxX + (raw - maxX) * 0.3 : raw < minX ? minX + (raw - minX) * 0.3 : raw;
    translateX.current = rubber;
    if (trackRef.current) trackRef.current.style.transform = `translateX(${rubber}px)`;
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!dragState.current.isDown) return;
    dragState.current.isDown = false;
    const dx = e.clientX - dragState.current.startX;
    let next = activeIndex;
    if (Math.abs(dx) >= 48) next = dx < 0 ? activeIndex + 1 : activeIndex - 1;
    snapTo(next);
    setTimeout(() => { dragState.current.dragging = false; }, 60);
  }

  function onCarouselClick() {
    if (!dragState.current.dragging) {
      onCardTap?.(group.cards[activeIndex], cardRefs.current[activeIndex]);
    }
  }

  return (
    <div style={{ marginBottom: 8 }}>
      {/* Date header */}
      <div style={{
        height: 52, display: "flex", alignItems: "center", justifyContent: "space-between",
        paddingLeft: 24, paddingRight: 24,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "'Noto Sans KR', sans-serif", color: C.zinc600 }}>
          {group.date}
        </span>
        <span style={{ fontSize: 12, fontFamily: "'Noto Sans KR', sans-serif", color: C.zinc400 }}>
          {group.cards.length}편
        </span>
      </div>

      {/* Carousel window */}
      <div
        style={{
          width: SCREEN_W, height: CARD_H, overflow: "hidden",
          cursor: "pointer",
          userSelect: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={onCarouselClick}
      >
        <div
          ref={trackRef}
          style={{
            display: "flex", flexDirection: "row",
            height: CARD_H,
            transform: `translateX(${getBaseX(0)}px)`,
            willChange: "transform",
          }}
        >
          {group.cards.map((card, i) => (
            <div
              key={card.id}
              ref={(el) => { cardRefs.current[i] = el; }}
              style={{
                marginRight: i < group.cards.length - 1 ? CARD_GAP : 0,
                visibility: hiddenCardId === card.id ? "hidden" : "visible",
              }}
            >
              <ArticleCard card={card} isActive={i === activeIndex} />
            </div>
          ))}
        </div>
      </div>

      {/* Dots */}
      <DotIndicator total={group.cards.length} activeIndex={activeIndex} />
    </div>
  );
}

/* ─── Letter view: the post-flip composition ───────────────────────
   Layered, in order from back to front:
     1. ArticleFirstPage  — the actual letter; stays put when the envelope
        slides away. Visible through the flap hole the moment the flap opens.
     2. Envelope body     — a polygon that excludes the flap-shaped wedge on
        the left so the letter shows through where the flap was.
     3. Envelope flap     — rotates open around its left hinge (~165°).
     4. Wax seal          — child of the flap; splits into two halves that
        rotate apart and fade as the flap unsticks.
   The envelope body + flap form a sibling group that translates right as a
   unit, leaving the letter behind. */
const FLAP_TIP_X = CARD_W * 0.62;
const FLAP_TIP_Y = CARD_H / 2;
const SEAL_SIZE  = 96;

function ArticleFirstPage({ card }: { card: MockCard }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#fdfcf8",
        padding: "44px 32px 32px",
        boxSizing: "border-box",
        fontFamily: "'Noto Sans KR', sans-serif",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        position: "relative",
      }}
    >
      <div style={{
        fontSize: 11, color: "#a39788", letterSpacing: 1,
        textTransform: "uppercase", fontWeight: 500,
      }}>
        From. {card.author}
      </div>
      <h2 style={{
        margin: 0, fontSize: 26, fontWeight: 700, color: "#2a2520",
        letterSpacing: -0.6, lineHeight: 1.3,
      }}>
        {card.title}
      </h2>
      <div style={{ width: 36, height: 1, background: "#d0c5b8", marginTop: 2, marginBottom: 4 }} />
      <p style={{
        margin: 0, fontSize: 14, lineHeight: 1.95, color: "#4a423a",
        letterSpacing: -0.2, whiteSpace: "pre-line",
      }}>
        {`오늘 창밖으로 흩어지는 빗소리를 들으며,
문득 당신께 편지를 쓰고 싶어졌습니다.

오랜만에 펜을 들었더니, 마음 한구석에
쌓여 있던 이야기들이 천천히 흘러나옵니다.
어디서부터 시작해야 할지 모르겠지만,
이 한 줄 한 줄을 당신께 보냅니다…`}
      </p>
    </div>
  );
}

function EnvelopeBody() {
  return (
    <svg
      width={CARD_W}
      height={CARD_H}
      viewBox={`0 0 ${CARD_W} ${CARD_H}`}
      style={{ position: "absolute", inset: 0, display: "block" }}
    >
      <defs>
        <linearGradient id="bodyFill" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"  stopColor="#fefefe" />
          <stop offset="100%" stopColor="#f1f1f3" />
        </linearGradient>
      </defs>
      {/* Body polygon — outline traces the rectangle but cuts inward along the
          flap-shaped wedge on the left, so that area shows whatever is behind
          (the article first page). */}
      <polygon
        points={`0,0 ${FLAP_TIP_X},${FLAP_TIP_Y} 0,${CARD_H} ${CARD_W},${CARD_H} ${CARD_W},0`}
        fill="url(#bodyFill)"
        stroke="rgba(0,0,0,0.06)"
        strokeWidth="0.5"
      />
      {/* Right-side seams converging toward the flap apex */}
      <line x1={CARD_W} y1={0}      x2={FLAP_TIP_X} y2={FLAP_TIP_Y}
            stroke="rgba(0,0,0,0.08)" strokeWidth="0.6" />
      <line x1={CARD_W} y1={CARD_H} x2={FLAP_TIP_X} y2={FLAP_TIP_Y}
            stroke="rgba(0,0,0,0.08)" strokeWidth="0.6" />
    </svg>
  );
}

function BrokenWaxSeal({ isBroken }: { isBroken: boolean }) {
  const halfBase: React.CSSProperties = {
    position: "absolute",
    left: FLAP_TIP_X - SEAL_SIZE / 2,
    top:  FLAP_TIP_Y - SEAL_SIZE / 2,
    width: SEAL_SIZE,
    height: SEAL_SIZE,
    pointerEvents: "none",
    userSelect: "none",
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
    filter: "drop-shadow(0 3px 5px rgba(0,0,0,0.28))",
    transition:
      "transform 0.55s cubic-bezier(0.3, 0.6, 0.4, 1), opacity 0.4s ease 0.3s",
  };
  return (
    <>
      {/* Left half */}
      <img
        src={waxSealUrl}
        alt=""
        draggable={false}
        style={{
          ...halfBase,
          clipPath: "polygon(0 0, 53% 0, 47% 100%, 0 100%)",
          transform: isBroken
            ? "translate(-22px, 16px) rotate(-26deg)"
            : "translate(0, 0) rotate(0deg)",
          opacity: isBroken ? 0 : 1,
        }}
      />
      {/* Right half */}
      <img
        src={waxSealUrl}
        alt=""
        draggable={false}
        style={{
          ...halfBase,
          clipPath: "polygon(53% 0, 100% 0, 100% 100%, 47% 100%)",
          transform: isBroken
            ? "translate(22px, 16px) rotate(26deg)"
            : "translate(0, 0) rotate(0deg)",
          opacity: isBroken ? 0 : 1,
        }}
      />
    </>
  );
}

function EnvelopeFlap({ isOpen }: { isOpen: boolean }) {
  return (
    <div
      data-role="envelope-flap"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: CARD_W,
        height: CARD_H,
        transformOrigin: "left center",
        transform: isOpen ? "rotateY(-168deg)" : "rotateY(0deg)",
        transition: "transform 0.6s cubic-bezier(0.45, 0, 0.25, 1)",
        transformStyle: "preserve-3d",
        pointerEvents: "none",
        // Hide own back-face: when this flap is mounted inside the parent
        // card's back face (rotateY 180 in world space), its own preserve-3d
        // would otherwise render facing away — leaking through the parent
        // card's front face.
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden",
      }}
    >
      <svg
        width={CARD_W}
        height={CARD_H}
        viewBox={`0 0 ${CARD_W} ${CARD_H}`}
        style={{ position: "absolute", inset: 0, display: "block" }}
      >
        <defs>
          <linearGradient id="flapFill" x1="0%" y1="50%" x2="100%" y2="50%">
            <stop offset="0%"  stopColor="#ffffff" />
            <stop offset="70%" stopColor="#f6f6f8" />
            <stop offset="100%" stopColor="#e6e6ea" />
          </linearGradient>
          <filter id="flapShadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="2" dy="0" stdDeviation="2" floodOpacity="0.10" />
          </filter>
        </defs>
        <polygon
          points={`0,0 ${FLAP_TIP_X},${FLAP_TIP_Y} 0,${CARD_H}`}
          fill="url(#flapFill)"
          stroke="rgba(0,0,0,0.08)"
          strokeWidth="0.6"
          filter="url(#flapShadow)"
        />
      </svg>
      <BrokenWaxSeal isBroken={isOpen} />
    </div>
  );
}

type ReadPhase = "idle" | "flipping" | "opened" | "slid";

function LetterView({ card, phase }: { card: MockCard; phase: ReadPhase }) {
  const flapOpen = phase === "opened" || phase === "slid";
  const isSlid   = phase === "slid";
  // Every flat-rendered child below gets its own backfaceVisibility:hidden,
  // because preserve-3d ancestors do NOT propagate the parent card's
  // back-face hiding. Without these, the envelope/article surfaces would
  // bleed through the front of the card before the flip crosses 90°.
  const HIDE_BACKFACE: React.CSSProperties = {
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
  };
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        transformStyle: "preserve-3d",
        ...HIDE_BACKFACE,
      }}
    >
      {/* 1. Article first page — stays put */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 16,
          overflow: "hidden",
          ...HIDE_BACKFACE,
        }}
      >
        <ArticleFirstPage card={card} />
      </div>

      {/* 2 + 3. Envelope group (body + flap with wax) — slides right as one */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: isSlid
            ? `translateX(${SCREEN_W + 40}px)`
            : "translateX(0px)",
          transition: "transform 0.7s cubic-bezier(0.5, 0, 0.55, 1)",
          transformStyle: "preserve-3d",
          ...HIDE_BACKFACE,
        }}
      >
        {/* Body — clipped to rounded corners (no 3D children inside) */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 16,
            overflow: "hidden",
            boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.06)",
            ...HIDE_BACKFACE,
          }}
        >
          <EnvelopeBody />
        </div>
        {/* Flap (with wax) — needs 3D, kept outside the clipping wrapper */}
        <EnvelopeFlap isOpen={flapOpen} />
      </div>
    </div>
  );
}

/* ─── Inbox screen ────────────────────────────────────────────── */
type ExpandedState = {
  card: MockCard;
  origin: { x: number; y: number; w: number; h: number };
};

/* ─── Reusable selection-mode (expanded card) ───────────────────── */
function useExpandedCard(screenRef: React.RefObject<HTMLDivElement | null>) {
  const [expanded, setExpanded] = useState<ExpandedState | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [readPhase, setReadPhase] = useState<ReadPhase>("idle");
  const isReading = readPhase !== "idle";
  const readingTimersRef = useRef<number[]>([]);
  const closeTimerRef = useRef<number | null>(null);
  // Synchronous ref lock — guards against same-frame double-trigger races
  // (state updates batch, so checking `readPhase` alone can race).
  const isReadingRef = useRef(false);

  function clearReadingTimers() {
    readingTimersRef.current.forEach((t) => window.clearTimeout(t));
    readingTimersRef.current = [];
  }

  function clearCloseTimer() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  // Clean up every pending timer when the host screen unmounts.
  useEffect(() => () => {
    clearReadingTimers();
    clearCloseTimer();
  }, []);

  function openCard(card: MockCard, element: HTMLElement | null) {
    if (!element || !screenRef.current) return;
    const cardRect = element.getBoundingClientRect();
    const screenRect = screenRef.current.getBoundingClientRect();
    clearReadingTimers();
    clearCloseTimer();
    isReadingRef.current = false;
    setExpanded({
      card,
      origin: {
        x: cardRect.left - screenRect.left,
        y: cardRect.top - screenRect.top,
        w: cardRect.width,
        h: cardRect.height,
      },
    });
    setReadPhase("idle");
    requestAnimationFrame(() => requestAnimationFrame(() => setIsOpen(true)));
  }

  function closeCard() {
    clearReadingTimers();
    clearCloseTimer();
    isReadingRef.current = false;
    setIsOpen(false);
    setReadPhase("idle");
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setExpanded(null);
    }, 420);
  }

  // 읽기 → flip (0.85s) → wax break + flap open (0.6s, simultaneous) →
  // envelope slides right off-screen (0.7s). Guarded against re-entry by both
  // a synchronous ref lock and the readPhase state. The front-of-card bleed
  // through is fixed at the CSS layer (backfaceVisibility on every 3D child
  // inside LetterView), so no rAF dance is needed here.
  function startReading() {
    if (isReadingRef.current || readPhase !== "idle") return;
    isReadingRef.current = true;
    clearReadingTimers();
    setReadPhase("flipping");
    readingTimersRef.current.push(
      window.setTimeout(() => setReadPhase("opened"), 850),
    );
    readingTimersRef.current.push(
      window.setTimeout(() => setReadPhase("slid"), 850 + 600),
    );
  }

  return { expanded, isOpen, readPhase, isReading, openCard, closeCard, startReading };
}

function ExpandedCardOverlay({
  expanded, isOpen, readPhase, isReading, onClose, onStartReading,
}: {
  expanded: ExpandedState | null;
  isOpen: boolean;
  readPhase: ReadPhase;
  isReading: boolean;
  onClose: () => void;
  onStartReading: () => void;
}) {
  if (!expanded) return null;

  // FLIP transform: at "closed" state the overlay card sits at the original
  // card's position with scale 1; at "open" state it scales up to EXP size at
  // the target position. Natural box is CARD_W×CARD_H placed at (0, EXP_TOP)
  // with transformOrigin top-left.
  const SCALE = EXP_W / CARD_W;
  const sx = expanded.origin.w / CARD_W;
  const sy = expanded.origin.h / CARD_H;
  const tx = expanded.origin.x;
  const ty = expanded.origin.y - EXP_TOP;
  const collapsedTransform = `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`;

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 100 }}>
      {/* Dim backdrop — click to close */}
      <div
        onClick={onClose}
        style={{
          position: "absolute", inset: 0,
          background: isReading ? "rgba(0,0,0,1)" : "rgba(0,0,0,0.62)",
          opacity: isOpen ? 1 : 0,
          transition: "opacity 0.42s ease-in-out, background 1.5s ease",
        }}
      />

      {/* The card itself — FLIPs from the source cell to the expanded rect */}
      <div
        style={{
          position: "absolute",
          top: EXP_TOP, left: 0,
          width: CARD_W, height: CARD_H,
          transformOrigin: "top left",
          transform: isOpen ? `translate(0px, 0px) scale(${SCALE})` : collapsedTransform,
          transition: "transform 0.42s cubic-bezier(0.34,1.02,0.64,1)",
          pointerEvents: "none",
          willChange: "transform",
          perspective: 1600,
        }}
      >
        <div
          style={{
            width: "100%", height: "100%", position: "relative",
            transformStyle: "preserve-3d",
            transform: isReading ? "rotateY(180deg)" : "rotateY(0deg)",
            transition: "transform 0.85s cubic-bezier(0.65, 0, 0.35, 1)",
          }}
        >
          {/* Front face — article card */}
          <div style={{
            position: "absolute", inset: 0,
            backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden",
          }}>
            <ArticleCard card={expanded.card} isActive={true} />
          </div>
          {/* Back face — letter view (article + envelope on top).
              Only mounted once 읽기 is pressed. Defense in depth: this wrapper
              hides its own back face, AND every 3D child inside <LetterView>
              (the flap, envelope body wrapper, article wrapper) sets its own
              `backfaceVisibility: hidden` — preserve-3d does NOT propagate
              the property, so without per-child hiding the envelope would
              bleed through the front of the card before the flip crosses 90°. */}
          <div style={{
            position: "absolute", inset: 0,
            backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            transformStyle: "preserve-3d",
          }}>
            {isReading && <LetterView card={expanded.card} phase={readPhase} />}
          </div>
        </div>
      </div>

      {/* Action buttons below the expanded card */}
      <div style={{
        position: "absolute",
        top: EXP_TOP + EXP_H + 12, left: 16, width: SCREEN_W - 32,
        display: "flex", gap: 8,
        opacity: isOpen && !isReading ? 1 : 0,
        transform: isOpen && !isReading ? "translateY(0px)" : "translateY(10px)",
        transition: "opacity 0.25s ease, transform 0.25s ease",
        pointerEvents: isOpen && !isReading ? "auto" : "none",
      }}>
        <button
          onClick={onStartReading}
          style={{
            flex: 1, height: 56, borderRadius: 16, border: "none",
            background: C.white, cursor: "pointer",
            fontFamily: "'Noto Sans KR', sans-serif",
            fontSize: 16, fontWeight: 600, color: C.zinc900, letterSpacing: -0.3,
          }}
        >
          읽기
        </button>
        <button style={{
          width: 56, height: 56, flexShrink: 0, borderRadius: 16, border: "none",
          background: C.noticeAccent, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M3.5 5.5h13M7.5 5.5V4a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 .5.5v1.5M5.5 5.5l.9 10a.5.5 0 0 0 .5.5h6.2a.5.5 0 0 0 .5-.5l.9-10" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            <line x1="10" y1="8" x2="10" y2="13" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
            <line x1="7.8" y1="8.1" x2="8.2" y2="13.1" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
            <line x1="12.2" y1="8.1" x2="11.8" y2="13.1" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

/* ─── Shared status bar ──────────────────────────────────────── */
function StatusBar() {
  return (
    <div style={{ height: STATUS_H, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", paddingLeft: 24, paddingRight: 20, paddingTop: 8 }}>
      <span style={{ fontSize: 15, fontWeight: 600, fontFamily: "'Noto Sans KR', sans-serif", color: C.zinc900, letterSpacing: -0.3 }}>9:41</span>
      <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
        <svg width="17" height="12" viewBox="0 0 17 12" fill={C.zinc900}>
          <rect x="0" y="3" width="3" height="9" rx="1"/><rect x="4.7" y="2.5" width="3" height="9.5" rx="1"/><rect x="9.4" y="0.5" width="3" height="11.5" rx="1"/><rect x="14" y="0" width="3" height="12" rx="1" opacity="0.28"/>
        </svg>
        <div style={{ width: 25, height: 12, border: `1.5px solid ${C.zinc900}`, borderRadius: 3.5, position: "relative", display: "flex", alignItems: "center", padding: "0 1.5px" }}>
          <div style={{ width: "78%", height: 7, background: C.zinc900, borderRadius: 1.5 }}/>
          <div style={{ position: "absolute", right: -5, top: "50%", transform: "translateY(-50%)", width: 3, height: 6, background: C.zinc900, borderRadius: 1, opacity: 0.4 }}/>
        </div>
      </div>
    </div>
  );
}

/* ─── Inbox screen ───────────────────────────────────────────── */
function InboxScreen({ navBottom }: { navBottom: number }) {
  const screenRef = useRef<HTMLDivElement>(null);
  const exp = useExpandedCard(screenRef);

  return (
    <div ref={screenRef} style={{ position: "absolute", inset: 0, background: C.white, display: "flex", flexDirection: "column" }}>
      <StatusBar />

      {/* Page header */}
      <div style={{ paddingLeft: 24, paddingRight: 20, paddingTop: 8, paddingBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, fontFamily: "'Noto Sans KR', sans-serif", color: C.zinc900, letterSpacing: -0.5, lineHeight: 1.1 }}>
          수신함
        </h1>
        <button style={{ background: "none", border: "none", cursor: "pointer", padding: 4, paddingBottom: 6 }}>
          <Icon name="search" size={20} color={C.zinc600} />
        </button>
      </div>

      {/* Scrollable list */}
      <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto", paddingBottom: navBottom, scrollbarWidth: "none", msOverflowStyle: "none" } as React.CSSProperties}>
        {MOCK_GROUPS.map((group) => (
          <CarouselGroup
            key={group.date}
            group={group}
            onCardTap={exp.openCard}
            hiddenCardId={exp.expanded?.card.id ?? null}
          />
        ))}
      </div>

      <ExpandedCardOverlay
        expanded={exp.expanded}
        isOpen={exp.isOpen}
        readPhase={exp.readPhase}
        isReading={exp.isReading}
        onClose={exp.closeCard}
        onStartReading={exp.startReading}
      />
    </div>
  );
}

/* ─── My screen — profile + 편지/연재/모임 sub-tabs ───────────── */
const MY_LETTERS: MockCard[] = [
  { id: "ml01", author: "나", title: "오늘의 일기",       bg: "#dbe982", textColor: "#3a3a1f" },
  { id: "ml02", author: "나", title: "도서관에서",         bg: "#a3d175", textColor: "#1a2a14" },
  { id: "ml03", author: "나", title: "긴 산책",            bg: "#e2e2e5", textColor: "#3a3a40" },
  { id: "ml04", author: "나", title: "비 내리는 창가",     bg: "#f5cf9e", textColor: "#3a2a1a" },
  { id: "ml05", author: "나", title: "주말의 단상",        bg: "#dfdde1", textColor: "#3a3540" },
  { id: "ml06", author: "나", title: "오랜만의 답장",      bg: "#f4a5a5", textColor: "#3a1a1a" },
  { id: "ml07", author: "나", title: "월요일의 다짐",      bg: "#a8bff0", textColor: "#1a2540" },
  { id: "ml08", author: "나", title: "서랍을 정리하며",    bg: "#f5a8b8", textColor: "#3a1a25" },
  { id: "ml09", author: "나", title: "오래된 노래",        bg: "#cba7f5", textColor: "#2a1540" },
  { id: "ml10", author: "나", title: "퇴근길 단상",        bg: "#1a1612", textColor: "#f0ebe0",
    image: "https://images.unsplash.com/photo-1538485399081-7191377e8241?w=400&q=80" },
  { id: "ml11", author: "나", title: "햇살 좋은 날",       bg: "#f4e8d6", textColor: "#3a2e22" },
  { id: "ml12", author: "나", title: "친구에게",           bg: "#bce5d4", textColor: "#1a3a2e" },
];

type MyTab = "letters" | "series" | "groups";
const MY_TABS: { key: MyTab; label: string }[] = [
  { key: "letters", label: "편지" },
  { key: "series",  label: "연재" },
  { key: "groups",  label: "모임" },
];

function LetterGrid({
  cards, onCardTap, hiddenCardId,
}: {
  cards: MockCard[];
  onCardTap: (c: MockCard, el: HTMLElement | null) => void;
  hiddenCardId: string | null;
}) {
  const GAP = 4;
  const PAD = 12;
  const COLS = 3;
  const CELL_W = Math.floor((SCREEN_W - PAD * 2 - GAP * (COLS - 1)) / COLS);
  const CELL_H = Math.floor(CELL_W * (CARD_H / CARD_W));
  const SCALE = CELL_W / CARD_W;
  const cellRefs = useRef<(HTMLDivElement | null)[]>([]);

  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: GAP,
      padding: `0 ${PAD}px`,
    }}>
      {cards.map((card, i) => (
        <div
          key={card.id}
          ref={(el) => { cellRefs.current[i] = el; }}
          onClick={() => onCardTap(card, cellRefs.current[i])}
          style={{
            width: CELL_W, height: CELL_H,
            position: "relative", overflow: "hidden",
            cursor: "pointer",
            visibility: hiddenCardId === card.id ? "hidden" : "visible",
          }}
        >
          {/* Full-size ArticleCard scaled down to fit the grid cell */}
          <div style={{
            position: "absolute", top: 0, left: 0,
            width: CARD_W, height: CARD_H,
            transform: `scale(${SCALE})`,
            transformOrigin: "top left",
          }}>
            <ArticleCard card={card} isActive={true} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MyScreen({ navBottom }: { navBottom: number }) {
  const screenRef = useRef<HTMLDivElement>(null);
  const exp = useExpandedCard(screenRef);
  const [myTab, setMyTab] = useState<MyTab>("letters");

  return (
    <div ref={screenRef} style={{ position: "absolute", inset: 0, background: C.white, display: "flex", flexDirection: "column" }}>
      <StatusBar />

      {/* Profile header */}
      <div style={{
        padding: "24px 28px 28px",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 0,
        flexShrink: 0,
      }}>
        <div style={{
          width: 78, height: 78, borderRadius: "50%",
          background: C.zinc100,
          boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.05)",
          marginBottom: 14,
        }} />
        <span style={{
          fontSize: 20, fontWeight: 800, fontFamily: "'Noto Sans KR', sans-serif",
          color: C.zinc900, letterSpacing: -0.5, lineHeight: 1.2,
        }}>
          사용자명
        </span>
        <span style={{
          fontSize: 12, fontFamily: "'Noto Sans KR', sans-serif",
          color: C.zinc400, marginTop: 4, letterSpacing: -0.1,
        }}>
          @자강두천
        </span>
      </div>

      {/* Sub-tabs: 편지 / 연재 / 모임 */}
      <div style={{
        display: "flex", borderBottom: `1px solid ${C.zinc100}`,
        flexShrink: 0,
      }}>
        {MY_TABS.map((t) => {
          const active = myTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setMyTab(t.key)}
              style={{
                flex: 1, padding: "12px 0 11px", background: "none", border: "none",
                cursor: "pointer", fontFamily: "'Noto Sans KR', sans-serif",
                fontSize: 14, fontWeight: active ? 700 : 500,
                color: active ? C.zinc900 : C.zinc400,
                letterSpacing: -0.2,
                borderBottom: active ? `2px solid ${C.zinc900}` : "2px solid transparent",
                marginBottom: -1,
                transition: "color 0.15s ease",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto", paddingTop: 12, paddingBottom: navBottom, scrollbarWidth: "none", msOverflowStyle: "none" } as React.CSSProperties}>
        {myTab === "letters" ? (
          <LetterGrid
            cards={MY_LETTERS}
            onCardTap={exp.openCard}
            hiddenCardId={exp.expanded?.card.id ?? null}
          />
        ) : (
          <div style={{
            padding: "80px 24px", textAlign: "center",
            color: C.zinc400, fontSize: 14, fontFamily: "'Noto Sans KR', sans-serif",
          }}>
            아직 비어있어요
          </div>
        )}
      </div>

      <ExpandedCardOverlay
        expanded={exp.expanded}
        isOpen={exp.isOpen}
        readPhase={exp.readPhase}
        isReading={exp.isReading}
        onClose={exp.closeCard}
        onStartReading={exp.startReading}
      />
    </div>
  );
}

/* ─── Placeholder for other (not-yet-built) tabs ─────────────── */
function PlaceholderScreen({ label }: { label: string }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: C.zinc50, display: "flex", flexDirection: "column" }}>
      <StatusBar />
      <div style={{ paddingLeft: 24, paddingTop: 8 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, fontFamily: "'Noto Sans KR', sans-serif", color: C.zinc900, letterSpacing: -0.5 }}>
          {label}
        </h1>
      </div>
    </div>
  );
}

/* ─── NavBar ─────────────────────────────────────────────────── */
function TabItem({ tab, active, onPress }: { tab: typeof TABS[number]; active: boolean; onPress: () => void }) {
  const [pressed, setPressed] = useState(false);
  return (
    <div
      onClick={onPress}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      style={{
        flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", gap: 2, cursor: "pointer", padding: "10px 0",
        transform: pressed ? "scale(0.92)" : active ? "scale(1.1)" : "scale(1)",
        transition: "transform 0.12s ease", userSelect: "none",
      }}
    >
      <Icon name={tab.icon} size={22} color={active ? C.tabActive : C.tabInactive} />
      <span style={{ fontSize: 10, fontWeight: 200, fontFamily: "'Noto Sans KR', sans-serif", color: active ? C.tabActive : C.tabInactiveAlt, lineHeight: 1 }}>
        {tab.label}
      </span>
    </div>
  );
}

function NavBar({ activeTab, onTabPress }: { activeTab: TabKey; onTabPress: (k: TabKey) => void }) {
  return (
    <div style={{
      position: "absolute",
      bottom: NAV_BOTTOM, left: "50%", transform: "translateX(-50%)",
      width: NAV_W, height: NAV_H, borderRadius: 999,
      background: C.navBarBg, border: `1px solid ${C.navBarBorder}`,
      boxShadow: "0 0 0 1px rgba(0,0,0,0.04), 0 4px 20px rgba(0,0,0,0.13), 0 1px 5px rgba(0,0,0,0.09)",
      display: "flex", flexDirection: "row", alignItems: "center",
      overflow: "hidden", zIndex: 30,
    }}>
      {TABS.map((tab) => (
        <TabItem key={tab.key} tab={tab} active={activeTab === tab.key} onPress={() => onTabPress(tab.key)} />
      ))}
    </div>
  );
}

function Fab({ visible }: { visible: boolean }) {
  return (
    <div style={{
      position: "absolute", right: 24, bottom: FAB_BOTTOM,
      width: FAB_SIZE, height: FAB_SIZE, borderRadius: FAB_SIZE / 2,
      background: C.zinc900,
      boxShadow: "0 2px 12px rgba(0,0,0,0.18), 0 1px 4px rgba(0,0,0,0.12)",
      display: "flex", alignItems: "center", justifyContent: "center",
      cursor: "pointer", zIndex: 31,
      opacity: visible ? 1 : 0,
      transform: visible ? "scale(1)" : "scale(0.7)",
      transition: "opacity 0.22s ease, transform 0.22s cubic-bezier(0.34,1.3,0.64,1)",
      pointerEvents: visible ? "auto" : "none",
    }}>
      <Icon name="edit" size={20} color="#FFFFFF" />
    </div>
  );
}

/* ─── Root ───────────────────────────────────────────────────── */
export function FrictionNavBar() {
  const [activeTab, setActiveTab] = useState<TabKey>("IN");
  const navBottom = NAV_BOTTOM + NAV_H + 8;
  const tab = TABS.find((t) => t.key === activeTab)!;

  return (
    <div style={{ width: SCREEN_W, height: SCREEN_H, position: "relative", overflow: "hidden", background: C.white }}>
      <style>{`.no-scrollbar::-webkit-scrollbar { display: none; width: 0; height: 0; }`}</style>
      {activeTab === "IN" ? (
        <InboxScreen navBottom={navBottom} />
      ) : activeTab === "MY" ? (
        <MyScreen navBottom={navBottom} />
      ) : (
        <PlaceholderScreen label={tab.label} />
      )}
      <NavBar activeTab={activeTab} onTabPress={setActiveTab} />
    </div>
  );
}
