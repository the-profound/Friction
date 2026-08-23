import React from "react";

const colors = {
  ink: "#162238",
  muted: "#5f6d82",
  line: "#cfd7e6",
  physical: "#17b5a5",
  web: "#f8c94d",
  nav: "#8d63e8",
  virtual: "#ff8a4c",
  content: "#4a90e2",
  chrome: "#e86470",
  selection: "#d85bb5",
};

const panelData = [
  {
    title: "3.1 작성 · 분할",
    subtitle: "일반 화면 흐름 + 가상 페이지 측정",
    type: "write",
    specs: [
      ["컨테이너 폭 W", "min(screenHeight × 5/8, screenWidth)"],
      ["가상 본문 폭", "safeAreaWidth = 0.90 × W"],
      ["텍스트 열", "round(0.90W − 2 × 0.06W) = round(0.78W)"],
      ["측정 높이", "safeAreaHeight = 1.20 × W"],
      ["분할 가용", "1.20W − 2 × 0.15W − insets.bottom"],
      ["측정 총높이", "sum(blocks) + 2 × 0.15W + insets.bottom"],
    ],
    note: "헤더·툴바·실제 화면 높이는 보이는 공간만 바꿉니다. 가상 페이지 분량 식에는 넣지 않습니다.",
  },
  {
    title: "3.2 상세 읽기",
    subtitle: "카드는 축소돼도 본문 기준 W는 유지",
    type: "reader",
    specs: [
      ["카드 가용 폭", "pageList width − 2 × 14 (그림자 여유)"],
      ["본문 기준 W", "article.layoutWidth 우선, 없으면 작성과 동일"],
      ["논리 카드", "W × (W / 5/8) · 표시에는 scaleFactor만 적용"],
      ["본문 하단", "inset.bottom + 0.15W + titleBarHeight"],
      ["메모 FAB", "bottom: inset.bottom + 24 · right: 20"],
      ["문장 pill", "inset.bottom + 80 + frame 위·아래 여백"],
      ["시트 중 상단", "inset.top + 8 · 본문 W는 유지"],
      ["완독 액션", "paddingBottom: max(inset.bottom, 24)"],
    ],
    note: "작아진 카드의 실제 폭으로 본문을 다시 계산하면 줄바꿈과 페이지 분량이 달라집니다.",
  },
  {
    title: "3.3 기록함 · 일반",
    subtitle: "floating NavBar 전체 높이와 위 간격을 회피",
    type: "archive",
    specs: [
      ["일반 헤더", "native: insets.top + headerPt · web: 67 + headerPt"],
      ["NavBar 위치", "insets.bottom + 20"],
      ["목록 하단", "navBottom = insets.bottom + 20 + 68 + 20"],
      ["웹 navBottom", "108px — 웹 fallback 34px은 자동 포함되지 않음"],
      ["빈 상태 하단", "paddingBottom: navBottom"],
    ],
    note: "navBottom은 inset을 이미 포함합니다. 여기에 insets.bottom을 다시 더하지 않습니다.",
  },
  {
    title: "3.3 기록함 · 문장 선택",
    subtitle: "NavBar 대신 absolute 삭제 바가 생기는 모드",
    type: "select",
    specs: [
      ["선택 root", "paddingTop: insets.top (web = 0)"],
      ["선택 헤더", "paddingTop: 50 · paddingBottom: 20"],
      ["삭제 바", "bottom: 0 · NavBar 대신 하단 chrome"],
      ["바 내부 하단", "inset.bottom + 20 + 68 + 12"],
      ["목록 reserve", "inset.bottom + 20 + 68 + 80"],
    ],
    note: "삭제 바의 내부 padding으로 목록 하단을 대체하면 마지막 항목이 바 아래로 들어갑니다.",
  },
];

function Label({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ ...styles.label, ...style }}>{children}</div>;
}

function Device({ type }: { type: string }) {
  if (type === "write") {
    return (
      <div style={styles.device}>
        <div style={styles.notch} />
        <Label style={box(0, 28, colors.physical)}>물리 top inset<br /><small>native: insets.top / web: 0</small></Label>
        <Label style={box(28, 61, colors.chrome)}>작성 헤더<br /><small>좌우 24 · 상하 12</small></Label>
        <Label style={box(89, 42, colors.chrome)}>분할 툴바<br /><small>좌우 24 · 상하 8</small></Label>
        <Label style={box(131, 44, colors.chrome)}>페이지 칩<br /><small>고정 44px</small></Label>
        <Label style={box(175, 305, colors.content)}>에디터의 실제 남은 화면 높이</Label>
        <Label style={box(205, 200, colors.virtual, 5, 90)}>가상 본문 박스<br /><small>폭 0.90W · 측정 높이 1.20W</small></Label>
        <Label style={box(250, 104, colors.content, 11, 78)}>명시 텍스트 열<br /><small>round(0.78W)</small></Label>
        <Label style={box(480, 31, colors.physical)}>물리 bottom inset<br /><small>분할 가용 높이에서만 차감</small></Label>
        <Label style={box(444, 36, colors.chrome)}>native 서식 툴바 회피<br /><small>keyboard 중 +60px</small></Label>
      </div>
    );
  }
  if (type === "reader") {
    return (
      <div style={styles.device}>
        <div style={styles.notch} />
        <Label style={box(0, 30, colors.physical)}>물리 top inset</Label>
        <div style={{ ...styles.circle, left: 14, top: 42 }}>←</div>
        <Label style={box(32, 22, colors.chrome, 48, 60)}>뒤로가기: top = inset + 12</Label>
        <div style={{ ...styles.side, left: 0 }} /><div style={{ ...styles.side, right: 0 }} />
        <div style={styles.card}>
          <div style={styles.virtualCard} />
          <div style={styles.textColumn}>가상 본문 0.90W<br /><small>명시 열 폭 round(0.78W)</small></div>
          <div style={styles.caption}>제목 바: round(20 + captionFontSize × 1.3)</div>
        </div>
        <Label style={box(432, 46, colors.content)}>카드 표시 frame<br /><small>논리 5:8 × scaleFactor</small></Label>
        <div style={{ ...styles.pill, bottom: 99 }}>문장 선택 pill</div>
        <div style={{ ...styles.circle, right: 20, bottom: 52, width: 36, height: 36 }}>메모<br />FAB</div>
        <Label style={box(507, 28, colors.physical)}>물리 bottom inset</Label>
      </div>
    );
  }
  if (type === "archive") {
    return (
      <div style={styles.device}>
        <div style={styles.notch} />
        <Label style={box(0, 45, colors.web)}>web fallback 67px<br /><small>native에서는 insets.top</small></Label>
        <Label style={box(45, 50, colors.chrome)}>PageHeader<br /><small>native inset + headerPt · web 67 + headerPt</small></Label>
        <Label style={box(95, 295, colors.content)}>일반 목록 / 그리드 / 빈 상태<br /><small>마지막 항목까지 스크롤</small></Label>
        <Label style={box(390, 108, colors.nav)}>NavBar clearance<br /><small>inset.bottom + 20 + 68 + 20</small></Label>
        <Label style={{ ...box(440, 48, colors.nav), left: 20, width: "calc(100% - 40px)", borderRadius: 20, color: "white" }}>floating NavBar<br /><small>bottom = inset.bottom + 20</small></Label>
        <Label style={box(507, 20, colors.physical)}>physical bottom inset</Label>
      </div>
    );
  }
  return (
    <div style={styles.device}>
      <div style={styles.notch} />
      <Label style={box(0, 28, colors.physical)}>root top = insets.top<br /><small>web에서는 0</small></Label>
      <Label style={box(28, 74, colors.selection)}>선택 헤더<br /><small>paddingTop 50 · paddingBottom 20</small></Label>
      <Label style={box(102, 266, colors.content)}>선택 가능한 문장 목록</Label>
      <Label style={box(367, 168, colors.selection)}>목록 하단 reserve<br /><small>inset.bottom + 20 + 68 + 80</small></Label>
      <Label style={{ ...box(405, 100, colors.chrome), left: 14, width: "calc(100% - 28px)", borderRadius: "11px 11px 0 0" }}>absolute 선택 삭제 바<br /><small>bottom: 0 · 내부 bottom = inset.bottom + 20 + 68 + 12</small></Label>
      <Label style={box(513, 22, colors.physical)}>physical bottom inset</Label>
    </div>
  );
}

function box(top: number, height: number, color: string, left = 0, width = 100): React.CSSProperties {
  return { top, height, left: `${left}%`, width: `${width}%`, background: `${color}55`, borderColor: color };
}

export function SafeAreaLayoutDiagram() {
  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.h1}>화면별 안전 영역 · 본문 레이아웃 설계도</h1>
        <p style={styles.lead}>「Friction 안전 영역·본문 레이아웃 계산 기준」의 3. 화면별 현재 계산을 도면으로 옮겼습니다.<br />수치는 현재 코드의 기준식이며, 화면을 다시 설계하자는 제안이 아닙니다.</p>
        <div style={styles.formula}>물리 inset / 웹 fallback / NavBar clearance / 리더 가상 본문 박스는 서로 다른 값이다.</div>
      </header>
      <div style={styles.legend}>
        {[
          [colors.physical, "물리 기기 inset"], [colors.web, "웹 fallback"], [colors.chrome, "화면 chrome"],
          [colors.nav, "NavBar / 회피 영역"], [colors.virtual, "리더 가상 본문"], [colors.content, "텍스트 열 · 카드"],
          [colors.selection, "선택 모드 전용"],
        ].map(([color, text]) => <span key={text}><i style={{ ...styles.dot, background: color }} />{text}</span>)}
      </div>
      <section style={styles.grid}>
        {panelData.map((panel) => (
          <article style={styles.sheet} key={panel.title}>
            <h2 style={styles.h2}>{panel.title}</h2>
            <p style={styles.sub}>{panel.subtitle}</p>
            <Device type={panel.type} />
            <ul style={styles.specs}>{panel.specs.map(([name, value]) => <li key={name}><b>{name}</b><code>{value}</code></li>)}</ul>
            <p style={styles.callout}>{panel.note}</p>
          </article>
        ))}
      </section>
      <aside style={styles.note}><strong>도면을 읽는 핵심:</strong> 청록/노랑은 화면 가장자리를 피하기 위한 값이고, 보라는 NavBar가 있을 때 콘텐츠를 스크롤 가능하게 만드는 값입니다. 주황/파랑은 리더 카드 내부의 논리적 본문 지오메트리입니다.</aside>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", color: colors.ink, background: "linear-gradient(#e9edf5 1px, transparent 1px), linear-gradient(90deg, #e9edf5 1px, transparent 1px), #f6f8fc", backgroundSize: "24px 24px", fontFamily: "Inter, Pretendard, sans-serif" },
  header: { padding: "42px 40px 24px", background: "rgba(246,248,252,.94)", borderBottom: `1px solid ${colors.line}` },
  h1: { margin: 0, fontSize: 36, letterSpacing: "-.06em" },
  lead: { margin: "9px 0 0", color: colors.muted, lineHeight: 1.6, fontSize: 14 },
  formula: { display: "inline-block", marginTop: 13, padding: "8px 12px", borderRadius: 7, background: "#192a45", color: "#fff", font: "600 12px ui-monospace, monospace" },
  legend: { display: "flex", flexWrap: "wrap", gap: "8px 18px", padding: "22px 40px 0", fontSize: 12, fontWeight: 700 },
  dot: { display: "inline-block", width: 11, height: 11, borderRadius: 3, marginRight: 6, verticalAlign: -1 },
  grid: { display: "grid", gridTemplateColumns: "repeat(4, minmax(250px,1fr))", gap: 18, padding: "20px 40px 34px" },
  sheet: { minWidth: 0, padding: 15, border: `1px solid ${colors.line}`, borderRadius: 12, background: "rgba(255,255,255,.94)", boxShadow: "0 8px 25px rgba(20,38,68,.08)" },
  h2: { margin: 0, fontSize: 16, letterSpacing: "-.04em" },
  sub: { minHeight: 32, margin: "5px 0 14px", color: colors.muted, fontSize: 11, lineHeight: 1.4 },
  device: { position: "relative", width: 230, height: 535, margin: "0 auto 15px", overflow: "hidden", border: "7px solid #1d293d", borderRadius: 28, background: "#fff", boxShadow: "0 8px 0 #101827" },
  notch: { position: "absolute", zIndex: 2, top: 0, left: "50%", width: 76, height: 17, transform: "translateX(-50%)", background: "#1d293d", borderRadius: "0 0 13px 13px" },
  label: { position: "absolute", display: "flex", alignItems: "center", justifyContent: "center", padding: "3px 5px", border: "1px dashed rgba(22,34,56,.45)", textAlign: "center", fontSize: 9, fontWeight: 800, lineHeight: 1.18, zIndex: 1 },
  side: { position: "absolute", top: 190, width: 14, height: 230, background: "repeating-linear-gradient(-45deg,#d5def0 0 2px,#fff 2px 5px)" },
  card: { position: "absolute", top: 172, left: 14, width: "calc(100% - 28px)", height: 250, border: `2px solid ${colors.content}`, background: "#4a90e20f" },
  virtualCard: { position: "absolute", left: "5%", top: "12%", width: "90%", height: "73%", border: `2px solid ${colors.virtual}`, background: "#ff8a4c22" },
  textColumn: { position: "absolute", left: "11%", top: "27%", width: "78%", height: "39%", border: `2px solid ${colors.content}`, background: "#4a90e229", display: "grid", placeItems: "center", fontSize: 9, textAlign: "center", fontWeight: 800 },
  caption: { position: "absolute", bottom: 0, width: "100%", height: 30, display: "grid", placeItems: "center", background: "#e8647055", color: "#612b32", fontSize: 8, fontWeight: 800 },
  circle: { position: "absolute", zIndex: 3, width: 30, height: 30, display: "grid", placeItems: "center", border: `2px solid ${colors.chrome}`, borderRadius: "50%", background: "#fff", color: colors.chrome, fontSize: 9, fontWeight: 900 },
  pill: { position: "absolute", zIndex: 3, left: "50%", width: 90, height: 22, transform: "translateX(-50%)", display: "grid", placeItems: "center", border: `2px solid ${colors.chrome}`, borderRadius: 13, background: "#fff", color: "#a14528", fontSize: 8, fontWeight: 800 },
  specs: { listStyle: "none", margin: 0, padding: 0, borderTop: "1px solid #e3e8f2" },
  callout: { margin: "11px 0 0", padding: "8px 9px", borderLeft: `3px solid ${colors.chrome}`, background: "#fff4f5", color: "#5f3b43", fontSize: 10, lineHeight: 1.4 },
  note: { margin: "0 40px 34px", padding: "14px 16px", border: "1px solid #bad9d5", borderRadius: 10, background: "#effaf8", fontSize: 12, lineHeight: 1.55 },
};

// CSS for the compact specification rows lives here to keep the preview self-contained.
const specStyle = document.createElement("style");
specStyle.textContent = `.safe-spec-row{display:grid;grid-template-columns:72px 1fr;gap:6px;padding:7px 0;border-bottom:1px solid #e3e8f2;font-size:10px;line-height:1.35}.safe-spec-row b{font-size:9px;color:#40516a}.safe-spec-row code{padding:1px 3px;border-radius:3px;background:#eef2f8;color:#263f66;font:600 9px ui-monospace,monospace}`;
if (typeof document !== "undefined" && !document.getElementById("safe-area-spec-style")) {
  specStyle.id = "safe-area-spec-style";
  document.head.appendChild(specStyle);
}
