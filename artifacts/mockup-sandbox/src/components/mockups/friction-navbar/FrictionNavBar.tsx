import { useState } from "react";

/* ─────────────────────────────────────────────
   Friction 1.0.0 tokens (mirrored from constants/tokens.ts)
───────────────────────────────────────────── */
const C = {
  zinc900: "#18181b",
  zinc400: "#a1a1aa",
  zinc300: "#d4d4d8",
  zinc100: "#f4f4f5",
  white: "#FFFFFF",
  navBarBg: "#FFFFFF",
  navBarBorder: "rgba(0,0,0,0.06)",
  tabActive: "#18181b",
  tabInactive: "#d4d4d8",
  tabInactiveAlt: "#a1a1aa",
  backButtonBg: "#F4F4F5",
  backButtonIcon: "#52525b",
};

const TABS = [
  { key: "IN", label: "수신함",   icon: "inbox"   },
  { key: "AR", label: "보관함",   icon: "archive"  },
  { key: "ON", label: "기록함",   icon: "edit-3"   },
  { key: "OF", label: "단체 모음", icon: "users"    },
  { key: "TO", label: "발신함",   icon: "send"     },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/* ─────────────────────────────────────────────
   Feather icon mini-set (only icons used here)
───────────────────────────────────────────── */
function FeatherIcon({ name, size, color }: { name: string; size: number; color: string }) {
  const s = { width: size, height: size, display: "block" as const };
  const shared = { fill: "none", stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "inbox":
      return (
        <svg viewBox="0 0 24 24" style={s} {...shared}>
          <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
          <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
        </svg>
      );
    case "archive":
      return (
        <svg viewBox="0 0 24 24" style={s} {...shared}>
          <polyline points="21 8 21 21 3 21 3 8" />
          <rect x="1" y="3" width="22" height="5" />
          <line x1="10" y1="12" x2="14" y2="12" />
        </svg>
      );
    case "edit-3":
      return (
        <svg viewBox="0 0 24 24" style={s} {...shared}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      );
    case "users":
      return (
        <svg viewBox="0 0 24 24" style={s} {...shared}>
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 00-3-3.87" />
          <path d="M16 3.13a4 4 0 010 7.75" />
        </svg>
      );
    case "send":
      return (
        <svg viewBox="0 0 24 24" style={s} {...shared}>
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      );
    case "edit":
      return (
        <svg viewBox="0 0 24 24" style={s} {...shared}>
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      );
    default:
      return null;
  }
}

/* ─────────────────────────────────────────────
   iPhone 17 device shell
   Display: 393 × 852 pt  (scale-factor 3×)
   Device frame: 430 × 904 pt
───────────────────────────────────────────── */
const SCREEN_W = 393;
const SCREEN_H = 852;
const BEZEL_H  = 26;   // top bezel height
const BEZEL_S  = 18.5; // side bezel width
const DEVICE_W = SCREEN_W + BEZEL_S * 2; // 430
const DEVICE_H = SCREEN_H + BEZEL_H + 22; // 904 (top 26 + bottom 22)
const DEVICE_R = 55;   // corner radius of device shell

// iPhone safe areas
const SAFE_TOP    = 59; // status bar + Dynamic Island clearance
const SAFE_BOTTOM = 34;

// NavBar geometry (mirrors tokens)
const NAV_W  = 300;
const NAV_H  = 68;
const NAV_R  = 999;
const NAV_BOTTOM = SAFE_BOTTOM + 20; // 54pt from screen bottom

const FAB_SIZE   = 52;
const FAB_BOTTOM = NAV_BOTTOM + 8;
const FAB_RIGHT  = 24;

/* ─────────────────────────────────────────────
   Tab item
───────────────────────────────────────────── */
function TabItem({
  tab,
  active,
  onPress,
}: {
  tab: (typeof TABS)[number];
  active: boolean;
  onPress: () => void;
}) {
  const [pressed, setPressed] = useState(false);

  return (
    <div
      onClick={onPress}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        cursor: "pointer",
        transform: pressed ? "scale(0.92)" : active ? "scale(1.1)" : "scale(1)",
        transition: "transform 0.12s ease",
        padding: "10px 0",
        userSelect: "none",
      }}
    >
      <FeatherIcon
        name={tab.icon}
        size={22}
        color={active ? C.tabActive : C.tabInactive}
      />
      <span
        style={{
          fontSize: 10,
          fontWeight: 200,
          fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif",
          color: active ? C.tabActive : C.tabInactiveAlt,
          letterSpacing: 0,
          lineHeight: 1,
        }}
      >
        {tab.label}
      </span>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Phone screen content (placeholder per tab)
───────────────────────────────────────────── */
const TAB_BG: Record<TabKey, string> = {
  IN: "#FFFFFF",
  AR: "#FAFAFA",
  ON: "#FAFAFA",
  OF: "#FFFFFF",
  TO: "#FAFAFA",
};

function ScreenContent({ activeTab }: { activeTab: TabKey }) {
  const tab = TABS.find((t) => t.key === activeTab)!;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: TAB_BG[activeTab],
        display: "flex",
        flexDirection: "column",
        paddingTop: SAFE_TOP + 16,
        paddingLeft: 24,
        paddingRight: 24,
      }}
    >
      {/* Minimal header */}
      <div style={{
        fontSize: 28,
        fontWeight: 900,
        fontFamily: "'Pretendard', sans-serif",
        color: C.zinc900,
        letterSpacing: -0.5,
        lineHeight: 1.1,
      }}>
        {tab.label}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   NavBar (the dock pill)
───────────────────────────────────────────── */
function NavBar({ activeTab, onTabPress }: { activeTab: TabKey; onTabPress: (k: TabKey) => void }) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: NAV_BOTTOM,
        left: "50%",
        transform: "translateX(-50%)",
        width: NAV_W,
        height: NAV_H,
        borderRadius: NAV_R,
        background: C.navBarBg,
        border: `1px solid ${C.navBarBorder}`,
        boxShadow: "0 0 0 1px rgba(0,0,0,0.04), 0 4px 20px rgba(0,0,0,0.13), 0 1px 5px rgba(0,0,0,0.09)",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        overflow: "hidden",
        zIndex: 30,
      }}
    >
      {TABS.map((tab) => (
        <TabItem
          key={tab.key}
          tab={tab}
          active={activeTab === tab.key}
          onPress={() => onTabPress(tab.key)}
        />
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────
   FAB (기록함 tab only)
───────────────────────────────────────────── */
function Fab({ visible }: { visible: boolean }) {
  return (
    <div
      style={{
        position: "absolute",
        right: FAB_RIGHT,
        bottom: FAB_BOTTOM,
        width: FAB_SIZE,
        height: FAB_SIZE,
        borderRadius: FAB_SIZE / 2,
        background: C.zinc900,
        boxShadow: "0 2px 12px rgba(0,0,0,0.18), 0 1px 4px rgba(0,0,0,0.12)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        zIndex: 31,
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1)" : "scale(0.7)",
        transition: "opacity 0.22s ease, transform 0.22s cubic-bezier(0.34,1.3,0.64,1)",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <FeatherIcon name="edit" size={20} color="#FFFFFF" />
    </div>
  );
}

/* ─────────────────────────────────────────────
   iPhone 17 device shell (CSS only, no image)
───────────────────────────────────────────── */
function IPhoneShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: DEVICE_W,
        height: DEVICE_H,
        borderRadius: DEVICE_R,
        background: "linear-gradient(160deg, #2a2a2e 0%, #1a1a1e 60%, #141417 100%)",
        boxShadow:
          "inset 0 0 0 1px rgba(255,255,255,0.12), " +
          "0 40px 80px rgba(0,0,0,0.55), " +
          "0 12px 30px rgba(0,0,0,0.35), " +
          "0 3px 8px rgba(0,0,0,0.25)",
        position: "relative",
        flexShrink: 0,
      }}
    >
      {/* Side sheen */}
      <div style={{
        position: "absolute",
        inset: 0,
        borderRadius: DEVICE_R,
        background: "linear-gradient(90deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0) 8%, rgba(255,255,255,0) 92%, rgba(255,255,255,0.04) 100%)",
        pointerEvents: "none",
        zIndex: 1,
      }} />

      {/* Volume buttons (left side) */}
      {[82, 130, 174].map((top, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: -3.5,
            top,
            width: 3.5,
            height: i === 0 ? 34 : 60,
            borderRadius: "3px 0 0 3px",
            background: "linear-gradient(90deg, #2a2a2d, #3a3a3e)",
            boxShadow: "inset 1px 0 0 rgba(255,255,255,0.08)",
          }}
        />
      ))}
      {/* Power button (right side) */}
      <div style={{
        position: "absolute",
        right: -3.5,
        top: 140,
        width: 3.5,
        height: 82,
        borderRadius: "0 3px 3px 0",
        background: "linear-gradient(270deg, #2a2a2d, #3a3a3e)",
        boxShadow: "inset -1px 0 0 rgba(255,255,255,0.08)",
      }} />

      {/* Screen cutout */}
      <div
        style={{
          position: "absolute",
          left: BEZEL_S,
          top: BEZEL_H,
          width: SCREEN_W,
          height: SCREEN_H,
          borderRadius: 44,
          overflow: "hidden",
          background: "#fff",
        }}
      >
        {children}

        {/* Status bar */}
        <div style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: SAFE_TOP,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          paddingTop: 14,
          paddingLeft: 24,
          paddingRight: 20,
          zIndex: 50,
          pointerEvents: "none",
        }}>
          <span style={{ fontSize: 15, fontWeight: 600, fontFamily: "'SF Pro Text', '-apple-system', sans-serif", color: C.zinc900, letterSpacing: -0.3 }}>9:41</span>
          {/* Dynamic Island */}
          <div style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            width: 126,
            height: 37,
            borderRadius: 20,
            background: "#000",
          }} />
          {/* Status icons */}
          <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
            {/* Signal */}
            <svg width="17" height="12" viewBox="0 0 17 12" fill={C.zinc900}>
              <rect x="0" y="4" width="3" height="8" rx="1" />
              <rect x="4.7" y="2.5" width="3" height="9.5" rx="1" />
              <rect x="9.4" y="0.5" width="3" height="11.5" rx="1" />
              <rect x="14" y="0" width="3" height="12" rx="1" opacity="0.28" />
            </svg>
            {/* Battery */}
            <div style={{ width: 25, height: 12, border: `1.5px solid ${C.zinc900}`, borderRadius: 3.5, position: "relative", display: "flex", alignItems: "center", padding: "0 1.5px" }}>
              <div style={{ width: "78%", height: 7, background: C.zinc900, borderRadius: 1.5 }} />
              <div style={{ position: "absolute", right: -5, top: "50%", transform: "translateY(-50%)", width: 3, height: 6, background: C.zinc900, borderRadius: 1, opacity: 0.4 }} />
            </div>
          </div>
        </div>

        {/* Home indicator */}
        <div style={{
          position: "absolute",
          bottom: 8,
          left: "50%",
          transform: "translateX(-50%)",
          width: 134,
          height: 5,
          borderRadius: 3,
          background: "rgba(0,0,0,0.2)",
          zIndex: 50,
          pointerEvents: "none",
        }} />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Root component — phone only, no decoration
───────────────────────────────────────────── */
export function FrictionNavBar() {
  const [activeTab, setActiveTab] = useState<TabKey>("IN");

  return (
    <IPhoneShell>
      <ScreenContent activeTab={activeTab} />
      <NavBar activeTab={activeTab} onTabPress={setActiveTab} />
      <Fab visible={activeTab === "ON"} />
    </IPhoneShell>
  );
}
