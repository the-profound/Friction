import { useRef, useState } from "react";

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

const TITLE_SIZE  = (6.5 / 100) * CARD_W;   // 19.5
const AUTHOR_SIZE = (3.6 / 100) * CARD_W;   // 10.8

const NAV_W  = 300;
const NAV_H  = 68;
const SAFE_BOTTOM = 34;
const NAV_BOTTOM  = SAFE_BOTTOM + 20;
const FAB_SIZE    = 52;
const FAB_BOTTOM  = NAV_BOTTOM + 8;
const STATUS_H    = 44; // mock status-bar height

/* ─── Tabs ───────────────────────────────────────────────────── */
const TABS = [
  { key: "IN", label: "수신",  icon: "inbox"     },
  { key: "SR", label: "연재",  icon: "book-open" },
  { key: "ON", label: "기록",  icon: "edit-3"    },
  { key: "MO", label: "모임",  icon: "users"     },
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
        bg: "#F5F0E8",
        textColor: "#2a2015",
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
        bg: "#DDEAF5",
        textColor: "#1a2c3d",
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
        bg: "#F5E8EA",
        textColor: "#3a1a1d",
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
      {/* Badges */}
      {(card.isNotice || card.isReply) && (
        <div style={{ position: "absolute", top: 12, left: 12, display: "flex", flexDirection: "column", gap: 4, zIndex: 2 }}>
          {card.isNotice && (
            <span style={{
              alignSelf: "flex-start", background: C.white, color: C.noticeAccent,
              fontSize: 12, fontWeight: 600, fontFamily: "'Pretendard', sans-serif",
              padding: "4px 10px", borderRadius: 999,
            }}>인사</span>
          )}
          {card.isReply && (
            <span style={{
              alignSelf: "flex-start", background: C.white, color: C.zinc900,
              fontSize: 12, fontWeight: 600, fontFamily: "'Pretendard', sans-serif",
              padding: "4px 10px", borderRadius: 4,
            }}>답장</span>
          )}
        </div>
      )}

      {/* Text content — vertically centered */}
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column", justifyContent: "center",
        padding: 20,
      }}>
        <span style={{
          display: "block",
          fontSize: AUTHOR_SIZE,
          lineHeight: `${AUTHOR_SIZE * 1.8}px`,
          fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif",
          fontWeight: 300,
          color: card.textColor,
          marginBottom: 6,
        }}>
          {card.author}
        </span>
        <span style={{
          display: "block",
          fontSize: TITLE_SIZE,
          lineHeight: `${TITLE_SIZE * 1.2}px`,
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontWeight: 700,
          color: card.textColor,
          letterSpacing: `${-0.02 * TITLE_SIZE}px`,
          WebkitLineClamp: 4,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
        } as React.CSSProperties}>
          {card.title}
        </span>
      </div>

      {/* Collection tag */}
      {card.collection && (
        <div style={{
          position: "absolute", bottom: 12, left: 12,
          background: C.white, borderRadius: 999,
          padding: "4px 10px", zIndex: 2,
        }}>
          <span style={{ fontSize: 12, color: C.zinc700, fontFamily: "'Pretendard', sans-serif" }}>
            {card.collection}
          </span>
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
function CarouselGroup({ group }: { group: MockGroup }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const translateX = useRef(getBaseX(0));
  const trackRef = useRef<HTMLDivElement>(null);

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

  return (
    <div style={{ marginBottom: 8 }}>
      {/* Date header */}
      <div style={{
        height: 52, display: "flex", alignItems: "center", justifyContent: "space-between",
        paddingLeft: 24, paddingRight: 24,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "'Pretendard', sans-serif", color: C.zinc600 }}>
          {group.date}
        </span>
        <span style={{ fontSize: 12, fontFamily: "'Pretendard', sans-serif", color: C.zinc400 }}>
          {group.cards.length}편
        </span>
      </div>

      {/* Carousel window */}
      <div
        style={{
          width: SCREEN_W, height: CARD_H, overflow: "hidden",
          cursor: group.cards.length > 1 ? "grab" : "default",
          userSelect: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
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
            <div key={card.id} style={{ marginRight: i < group.cards.length - 1 ? CARD_GAP : 0 }}>
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

/* ─── Inbox screen ────────────────────────────────────────────── */
function InboxScreen({ navBottom }: { navBottom: number }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: C.white, display: "flex", flexDirection: "column" }}>
      {/* Status-bar placeholder */}
      <div style={{ height: STATUS_H, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", paddingLeft: 24, paddingRight: 20, paddingTop: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 600, fontFamily: "'SF Pro Text', '-apple-system', sans-serif", color: C.zinc900, letterSpacing: -0.3 }}>9:41</span>
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

      {/* Page header */}
      <div style={{ paddingLeft: 24, paddingRight: 20, paddingTop: 8, paddingBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif", color: C.zinc900, letterSpacing: -0.5, lineHeight: 1.1 }}>
          수신함
        </h1>
        <button style={{ background: "none", border: "none", cursor: "pointer", padding: 4, paddingBottom: 6 }}>
          <Icon name="search" size={20} color={C.zinc600} />
        </button>
      </div>

      {/* Scrollable list */}
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: navBottom }}>
        {MOCK_GROUPS.map((group) => (
          <CarouselGroup key={group.date} group={group} />
        ))}
      </div>
    </div>
  );
}

/* ─── Placeholder for other tabs ─────────────────────────────── */
function PlaceholderScreen({ label }: { label: string }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: C.zinc50, display: "flex", flexDirection: "column" }}>
      <div style={{ height: STATUS_H, flexShrink: 0 }} />
      <div style={{ paddingLeft: 24, paddingTop: 8 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, fontFamily: "'Pretendard', sans-serif", color: C.zinc900, letterSpacing: -0.5 }}>
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
      <span style={{ fontSize: 10, fontWeight: 200, fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif", color: active ? C.tabActive : C.tabInactiveAlt, lineHeight: 1 }}>
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
      {activeTab === "IN"
        ? <InboxScreen navBottom={navBottom} />
        : <PlaceholderScreen label={tab.label} />
      }
      <NavBar activeTab={activeTab} onTabPress={setActiveTab} />
    </div>
  );
}
