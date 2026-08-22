import { useState, type CSSProperties } from "react";

type TabKey = "IN" | "OF" | "ON" | "AR" | "TO";

const colors = {
  ink: "#18181b",
  muted: "#9b9ba1",
  pale: "#d9d9dc",
  paper: "#f8f7f4",
  white: "#fffdfb",
  line: "rgba(24,24,27,0.08)",
  blush: "#efe7e3",
  burgundy: "#92323d",
};

const tabs: { key: TabKey; label: string; icon: string }[] = [
  { key: "IN", label: "수신", icon: "inbox" },
  { key: "OF", label: "공간", icon: "grid" },
  { key: "ON", label: "기록", icon: "edit-3" },
  { key: "AR", label: "보관", icon: "archive" },
  { key: "TO", label: "마이", icon: "user" },
];

function FeatherIcon({
  name,
  size = 18,
  color = colors.ink,
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  const base = {
    width: size,
    height: size,
    display: "block",
    fill: "none",
    stroke: color,
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (name) {
    case "inbox":
      return <svg viewBox="0 0 24 24" style={base}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" /></svg>;
    case "grid":
      return <svg viewBox="0 0 24 24" style={base}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>;
    case "edit-3":
      return <svg viewBox="0 0 24 24" style={base}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" /></svg>;
    case "archive":
      return <svg viewBox="0 0 24 24" style={base}><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></svg>;
    case "user":
      return <svg viewBox="0 0 24 24" style={base}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
    case "plus":
      return <svg viewBox="0 0 24 24" style={base}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
    case "arrow-up-right":
      return <svg viewBox="0 0 24 24" style={base}><line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" /></svg>;
    default:
      return null;
  }
}

function MiniLetter({ title, author, tone }: { title: string; author: string; tone: string }) {
  return (
    <article style={{ ...styles.letter, background: tone }}>
      <div style={styles.letterRule} />
      <div style={styles.letterTitle}>{title}</div>
      <div style={styles.letterAuthor}>{author}</div>
      <div style={styles.letterStamp}>FRICTION / 05</div>
    </article>
  );
}

export function ProposedNavBar({ ctaColor = colors.ink }: { ctaColor?: string }) {
  const [active, setActive] = useState<TabKey>("IN");
  const [composerOpen, setComposerOpen] = useState(false);
  const [toast, setToast] = useState("");

  function selectTab(key: TabKey) {
    setActive(key);
    setToast(`${tabs.find((tab) => tab.key === key)?.label}으로 이동`);
    window.setTimeout(() => setToast(""), 1400);
  }

  function openComposer() {
    setComposerOpen((current) => !current);
    setToast(composerOpen ? "" : "새 단상을 시작합니다");
  }

  return (
    <main style={styles.canvas}>
      <section style={styles.phone} aria-label="Friction 앱 하단 네비게이션 개선안">
        <header style={styles.header}>
          <span style={styles.wordmark}>friction</span>
          <span style={styles.headerMeta}>수신함 <span style={styles.unreadDot} /></span>
        </header>

        <div style={styles.content}>
          <div style={styles.eyebrow}>WEDNESDAY · MAY 28</div>
          <h1 style={styles.heading}>천천히 도착한<br /><em style={{ fontStyle: "italic", color: "#665b55" }}>몇 통의 마음</em></h1>
          <p style={styles.intro}>오늘의 편지와 단상을<br />한 장씩 펼쳐보세요.</p>
          <div style={styles.letters}>
            <MiniLetter title="5월의 인사" author="운영진" tone="#eeebe6" />
            <MiniLetter title="비 오는 날의 단상" author="김서연" tone="#d8c8bf" />
          </div>
          <div style={styles.pageHint}><span style={styles.pageHintSpan} /> 02 / 08</div>
        </div>

        <div style={styles.bottomArea}>
          {composerOpen && (
            <div style={styles.composerCard}>
              <div style={styles.composerKicker}>새 단상</div>
              <div style={styles.composerLine}>지금 마음에 남은 한 줄을 적어보세요.</div>
              <button type="button" onClick={() => setToast("작성 화면으로 이동합니다")} style={styles.startWriting}>
                작성 시작 <FeatherIcon name="arrow-up-right" size={16} color={colors.white} />
              </button>
            </div>
          )}
          <nav style={styles.navShell} aria-label="주요 메뉴">
            <div style={styles.menuGroup}>
              {tabs.map((tab) => {
                const isActive = active === tab.key;
                return (
                  <button
                    type="button"
                    key={tab.key}
                    onClick={() => selectTab(tab.key)}
                    aria-label={`${tab.label} 탭`}
                    aria-current={isActive ? "page" : undefined}
                    style={styles.tab}
                  >
                    <FeatherIcon name={tab.icon} size={22} color={isActive ? "#18181b" : "#d4d4d8"} />
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={openComposer} aria-label="새 단상 작성" aria-expanded={composerOpen} style={{ ...styles.cta, background: ctaColor }}>
              <FeatherIcon name="edit-3" size={22} color={colors.white} />
            </button>
          </nav>
        </div>
        {toast && <div role="status" style={styles.toast}>{toast}</div>}
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  canvas: {
    minHeight: "100vh", display: "flex", justifyContent: "center", alignItems: "center",
    background: "#e9e5e0", padding: 18, boxSizing: "border-box",
    fontFamily: "'Noto Sans KR', 'Plus Jakarta Sans', sans-serif",
  },
  phone: {
    width: "min(393px, 100%)", height: "min(852px, calc(100vh - 36px))", minHeight: 650,
    position: "relative", overflow: "hidden", background: colors.paper, color: colors.ink,
    boxShadow: "0 22px 60px rgba(56,45,38,0.18)", borderRadius: 24,
  },
  header: {
    height: 68, display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "0 24px", borderBottom: `1px solid ${colors.line}`,
  },
  wordmark: { fontFamily: "'Playfair Display', serif", fontSize: 20, letterSpacing: -0.6 },
  headerMeta: { color: colors.muted, fontSize: 11, display: "flex", gap: 7, alignItems: "center" },
  unreadDot: { width: 5, height: 5, borderRadius: "50%", background: colors.burgundy, display: "inline-block" },
  content: { padding: "38px 28px 130px" },
  eyebrow: { color: colors.burgundy, fontSize: 10, letterSpacing: 1.4, fontWeight: 700 },
  heading: { fontFamily: "'Playfair Display', serif", fontSize: 34, lineHeight: 1.18, fontWeight: 500, letterSpacing: -1.5, margin: "18px 0 14px" },
  intro: { margin: 0, color: colors.muted, fontSize: 13, lineHeight: 1.8 },
  letters: { display: "flex", gap: 12, marginTop: 32 },
  letter: { height: 200, flex: 1, padding: 18, boxSizing: "border-box", position: "relative", boxShadow: "0 8px 18px rgba(45,38,34,0.06)" },
  letterRule: { width: 24, height: 2, background: colors.burgundy, opacity: 0.7, marginBottom: 24 },
  letterTitle: { fontFamily: "'Playfair Display', serif", fontSize: 19, lineHeight: 1.35 },
  letterAuthor: { fontSize: 11, color: "#756c67", marginTop: 8 },
  letterStamp: { position: "absolute", bottom: 17, left: 18, color: "#968b83", fontSize: 8, letterSpacing: 1.2 },
  pageHint: { marginTop: 18, color: colors.muted, fontSize: 10, letterSpacing: 1.1, display: "flex", gap: 8, alignItems: "center" },
  pageHintSpan: { display: "inline-block", width: 23, height: 1, background: colors.muted },
  bottomArea: { position: "absolute", left: 0, right: 0, bottom: 0, padding: "0 16px 22px", background: "linear-gradient(transparent, rgba(248,247,244,0.97) 22%)", paddingTop: 38 },
  navShell: { height: 70, display: "flex", alignItems: "center", gap: 12 },
  menuGroup: { flex: 1, height: 70, display: "flex", alignItems: "center", justifyContent: "space-around", minWidth: 0, background: colors.white, border: `1px solid ${colors.line}`, borderRadius: 32, padding: "0 5px", boxShadow: "0 9px 22px rgba(38,31,27,0.1)" },
  tab: { appearance: "none", border: 0, background: "transparent", padding: "14px 4px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", minWidth: 39, fontFamily: "inherit" },
  cta: { appearance: "none", border: 0, background: colors.ink, color: colors.white, borderRadius: 35, width: 70, minWidth: 70, height: 70, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 5px 12px rgba(24,24,27,0.2)" },
  composerCard: { position: "absolute", bottom: 98, left: 16, right: 16, background: colors.ink, color: colors.white, borderRadius: 18, padding: "18px 18px 16px", boxShadow: "0 14px 30px rgba(24,24,27,0.2)" },
  composerKicker: { color: "#cdb7ae", fontSize: 10, letterSpacing: 1.2, marginBottom: 9 },
  composerLine: { fontFamily: "'Playfair Display', serif", fontSize: 19, lineHeight: 1.35, marginBottom: 15 },
  startWriting: { border: 0, borderRadius: 10, background: colors.burgundy, color: colors.white, padding: "9px 12px", display: "flex", alignItems: "center", gap: 7, fontFamily: "inherit", fontSize: 11, cursor: "pointer" },
  toast: { position: "absolute", top: 78, left: "50%", transform: "translateX(-50%)", background: colors.ink, color: colors.white, borderRadius: 99, fontSize: 11, padding: "8px 13px", whiteSpace: "nowrap", boxShadow: "0 7px 18px rgba(24,24,27,0.15)" },
};