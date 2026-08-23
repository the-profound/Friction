import React from "react";

const C = {
  ink: "#17243b",
  muted: "#5e6d82",
  grid: "#dde4ee",
  physical: "#16b5a5",
  screen: "#7c68dd",
  virtual: "#ff8b4d",
  content: "#3d8ee8",
  card: "#e85e73",
  paper: "#ffffff",
};

function Zone({
  children,
  color,
  style,
}: {
  children: React.ReactNode;
  color: string;
  style: React.CSSProperties;
}) {
  return (
    <div
      style={{
        position: "absolute",
        display: "grid",
        placeItems: "center",
        boxSizing: "border-box",
        padding: "3px 5px",
        border: `1.5px dashed ${color}`,
        background: `${color}2d`,
        color: C.ink,
        fontWeight: 750,
        fontSize: 10,
        lineHeight: 1.25,
        textAlign: "center",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Device({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        width: 300,
        height: 530,
        margin: "0 auto",
        overflow: "hidden",
        border: "8px solid #1c283d",
        borderRadius: 34,
        background: "#fff",
        boxShadow: "0 10px 0 #111a2a",
      }}
    >
      <div style={{ position: "absolute", zIndex: 3, top: 0, left: "50%", width: 100, height: 22, transform: "translateX(-50%)", borderRadius: "0 0 15px 15px", background: "#1c283d" }} />
      {children}
    </div>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return <code style={{ display: "block", marginTop: 3, color: "#24446e", font: "700 11px ui-monospace, SFMono-Regular, Menlo, monospace", overflowWrap: "anywhere" }}>{children}</code>;
}

function RecordCardPanel() {
  return (
    <section style={styles.panel}>
      <div style={styles.kicker}>01 · 기록함</div>
      <h2 style={styles.h2}>기록 카드 안의 본문 여백</h2>
      <p style={styles.intro}>카드 자체 폭 <b>C</b>가 기준입니다. 기기 safe area나 NavBar clearance는 카드 내부 본문에 더하지 않습니다.</p>
      <Device>
        <Zone color={C.screen} style={{ top: 0, left: 0, width: "100%", height: 74 }}>기록함 화면의 카드 슬롯<Formula>C = min(화면 폭 − 48, 300)</Formula></Zone>
        <div style={{ position: "absolute", top: 106, left: 24, right: 24, bottom: 48, borderRadius: 19, background: "#fff", border: `3px solid ${C.card}`, boxShadow: "0 8px 16px #17243b22" }}>
          <Zone color={C.card} style={{ top: 0, left: 0, width: "100%", height: "18%" }}>카드 상단 본문 여백<Formula>paddingTop = 0.15C</Formula></Zone>
          <Zone color={C.card} style={{ left: 0, bottom: 0, width: "100%", height: "18%" }}>카드 하단 본문 여백<Formula>paddingBottom = 0.15C</Formula></Zone>
          <Zone color={C.virtual} style={{ top: "18%", bottom: "18%", left: 0, width: "12%" }}>좌측<Formula>0.06C</Formula></Zone>
          <Zone color={C.virtual} style={{ top: "18%", bottom: "18%", right: 0, width: "12%" }}>우측<Formula>0.06C</Formula></Zone>
          <Zone color={C.content} style={{ top: "18%", bottom: "18%", left: "12%", width: "76%" }}>
            제목 + 본문<br /><small style={{ fontWeight: 650 }}>본문 렌더 폭: C − 2 × 0.06C = 0.88C</small>
          </Zone>
        </div>
        <Zone color={C.physical} style={{ bottom: 0, left: 0, width: "100%", height: 38 }}>화면 하단 NavBar 회피는 목록의 일<small style={{ fontWeight: 650 }}>카드 내부 padding과 별개</small></Zone>
      </Device>
      <div style={styles.callout}>
        <strong>카드 내부 계산</strong>
        <Formula>좌·우 = 0.06C · 상·하 = 0.15C</Formula>
        <Formula>본문 줄 수 = floor((카드 H − 0.30C − 제목 높이 − 8) / 본문 줄높이)</Formula>
      </div>
      <p style={styles.note}>카드 폭은 화면 양쪽 <b>24px</b>을 제외하고, 최대 <b>300px</b>으로 제한됩니다. 제목 줄 수 측정에는 공통 <code>textColumnWidth = round(0.78C)</code>를 사용하지만, 이 카드의 실제 content padding은 위의 <b>0.06C</b>입니다.</p>
    </section>
  );
}

function ReaderPanel() {
  return (
    <section style={styles.panel}>
      <div style={styles.kicker}>02 · 상세 읽기</div>
      <h2 style={styles.h2}>좌우상하 본문 안전 영역</h2>
      <p style={styles.intro}>페이지 카드와 본문은 <b>저장된 논리 폭 W</b>를 기준으로 계산합니다. 카드가 화면에 맞춰 축소돼도 본문 메트릭은 다시 계산하지 않습니다.</p>
      <Device>
        <Zone color={C.physical} style={{ top: 0, left: 0, width: "100%", height: 42 }}>물리 top inset은 뒤로가기 버튼에만 적용<Formula>top = insets.top + 12</Formula></Zone>
        <Zone color={C.screen} style={{ top: 50, left: 0, width: 40, bottom: 43 }}>카드 그림자 여유<Formula>14px</Formula></Zone>
        <Zone color={C.screen} style={{ top: 50, right: 0, width: 40, bottom: 43 }}>카드 그림자 여유<Formula>14px</Formula></Zone>
        <div style={{ position: "absolute", top: 68, bottom: 50, left: 40, right: 40, border: `2px solid ${C.content}`, background: "#3d8ee809" }}>
          <div style={{ position: "absolute", top: "7%", left: "5%", width: "90%", height: "78%", border: `2px solid ${C.virtual}`, background: "#ff8b4d16" }}>
            <Zone color={C.virtual} style={{ top: 0, left: 0, width: "100%", height: "20%" }}>본문 상단<Formula>paddingTop = 0.15W</Formula></Zone>
            <Zone color={C.virtual} style={{ top: "20%", bottom: "22%", left: 0, width: "12%" }}>좌<Formula>0.06W</Formula></Zone>
            <Zone color={C.virtual} style={{ top: "20%", bottom: "22%", right: 0, width: "12%" }}>우<Formula>0.06W</Formula></Zone>
            <Zone color={C.content} style={{ top: "20%", bottom: "22%", left: "12%", width: "76%" }}>실제 텍스트 열<Formula>round(0.78W)</Formula></Zone>
            <Zone color={C.card} style={{ bottom: 0, left: 0, width: "100%", height: "22%" }}>본문 하단<Formula>insets.bottom + 0.15W + titleBarHeight</Formula></Zone>
          </div>
          <div style={{ position: "absolute", bottom: 8, left: 0, width: "100%", textAlign: "center", fontSize: 9, fontWeight: 700, color: C.muted }}>페이지 가상 본문 박스 = 0.90W</div>
        </div>
        <Zone color={C.physical} style={{ bottom: 0, left: 0, width: "100%", height: 43 }}>물리 bottom inset<Formula>메모 FAB: insets.bottom + 24</Formula></Zone>
      </Device>
      <div style={styles.callout}>
        <strong>리더 본문 계산</strong>
        <Formula>가상 박스 폭 = 0.90W · 좌우 padding = 0.06W</Formula>
        <Formula>titleBarHeight = round(20 + captionFontSize × 1.3)</Formula>
      </div>
      <p style={styles.note}>화면 바깥의 <b>14px</b>은 카드 그림자를 위한 좌우 여유입니다. 본문 내부 여백이 아닙니다. 웹은 현재 <code>insets.top / bottom = 0</code>으로 동작하며, 이 리더 본문 식에 67/34px fallback을 넣지 않습니다.</p>
    </section>
  );
}

function WriterPanel() {
  return (
    <section style={styles.panel}>
      <div style={styles.kicker}>03 · 작성 화면</div>
      <h2 style={styles.h2}>좌우 본문 안전 영역</h2>
      <p style={styles.intro}>작성 화면의 좌우 여백은 물리 safe area가 아니라 <b>가상 컨테이너 W</b>와 그 안의 텍스트 열로 결정됩니다.</p>
      <Device>
        <Zone color={C.screen} style={{ top: 0, left: 0, width: "100%", height: 64 }}>작성 헤더의 화면 여백<Formula>paddingHorizontal = 24px</Formula></Zone>
        <Zone color={C.screen} style={{ top: 64, left: 0, width: "100%", height: 38 }}>분할 툴바의 화면 여백<Formula>paddingHorizontal = 24px</Formula></Zone>
        <div style={{ position: "absolute", top: 118, bottom: 38, left: 10, right: 10, display: "grid", placeItems: "center", background: "#eff4fb" }}>
          <Zone color={C.virtual} style={{ position: "relative", width: "90%", height: "75%" }}>
            <Zone color={C.screen} style={{ top: 0, left: 0, width: "100%", height: "18%" }}>가상 컨테이너<Formula>safeAreaWidth = 0.90W</Formula></Zone>
            <Zone color={C.virtual} style={{ top: "18%", bottom: 0, left: 0, width: "12%" }}>좌<Formula>0.06W</Formula></Zone>
            <Zone color={C.virtual} style={{ top: "18%", bottom: 0, right: 0, width: "12%" }}>우<Formula>0.06W</Formula></Zone>
            <Zone color={C.content} style={{ top: "18%", bottom: 0, left: "12%", width: "76%" }}>에디터 실제 텍스트 열<Formula>textColumnWidth = round(0.78W)</Formula></Zone>
          </Zone>
        </div>
        <Zone color={C.physical} style={{ bottom: 0, left: 0, width: "100%", height: 38 }}>좌·우 물리 inset은 사용하지 않음<Formula>상단만 insets.top</Formula></Zone>
      </Device>
      <div style={styles.callout}>
        <strong>가로 폭 계산</strong>
        <Formula>W = min(screenHeight × 5/8, screenWidth)</Formula>
        <Formula>가상 박스 시작 = (화면 폭 S − 0.90W) / 2</Formula>
        <Formula>본문 열 시작 = (S − round(0.78W)) / 2</Formula>
      </div>
      <p style={styles.note}>화면 폭과 W가 같다면 가상 박스의 좌우 여백은 각각 <b>0.05S</b>, 실제 본문 텍스트 열의 좌우 여백은 각각 약 <b>0.11S</b>입니다. 웹도 현재 같은 W 식을 쓰며, 작성 화면에는 웹 67px fallback을 별도로 적용하지 않습니다.</p>
    </section>
  );
}

export function SafeAreaLayoutDiagram() {
  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <p style={styles.eyebrow}>FRICTION · LAYOUT REFERENCE</p>
        <h1 style={styles.h1}>핵심 3개 화면의 본문 안전 영역</h1>
        <p style={styles.lead}>기록 카드 · 상세 읽기 · 작성 화면만 다시 계산했습니다. <b>색이 같은 영역은 같은 종류의 여백</b>이고, 기기 inset과 콘텐츠 내부 여백을 혼용하지 않습니다.</p>
        <div style={styles.legend}>
          <span><i style={{ ...styles.dot, background: C.physical }} />물리 기기 inset</span>
          <span><i style={{ ...styles.dot, background: C.screen }} />화면·카드 바깥 여백</span>
          <span><i style={{ ...styles.dot, background: C.virtual }} />가상 본문 padding</span>
          <span><i style={{ ...styles.dot, background: C.content }} />실제 텍스트 열</span>
          <span><i style={{ ...styles.dot, background: C.card }} />하단 오버레이·카드 reserve</span>
        </div>
      </header>
      <div style={styles.grid}>
        <RecordCardPanel />
        <ReaderPanel />
        <WriterPanel />
      </div>
      <footer style={styles.footer}>C = 기록 카드 폭 · W = 리더/에디터 논리 컨테이너 폭 · S = 화면 폭 · 실제 픽셀 값은 화면·기기 크기에 따라 계산됩니다.</footer>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    color: C.ink,
    background: `linear-gradient(${C.grid} 1px, transparent 1px),linear-gradient(90deg,${C.grid} 1px,transparent 1px),#f6f8fc`,
    backgroundSize: "22px 22px",
    fontFamily: "Inter, Pretendard, -apple-system, sans-serif",
  },
  header: { padding: "40px 48px 26px", background: "rgba(248,250,253,.94)", borderBottom: `1px solid ${C.grid}` },
  eyebrow: { margin: 0, color: C.screen, fontSize: 11, fontWeight: 800, letterSpacing: ".12em" },
  h1: { margin: "7px 0 8px", fontSize: 36, letterSpacing: "-.06em" },
  lead: { maxWidth: 820, margin: 0, color: C.muted, fontSize: 14, lineHeight: 1.6 },
  legend: { display: "flex", flexWrap: "wrap", gap: "9px 18px", marginTop: 17, fontSize: 12, fontWeight: 700 },
  dot: { display: "inline-block", width: 11, height: 11, marginRight: 6, borderRadius: 3, verticalAlign: -1 },
  grid: { display: "grid", gridTemplateColumns: "repeat(3,minmax(280px,1fr))", gap: 22, padding: "26px 40px 20px" },
  panel: { minWidth: 0, padding: 18, border: `1px solid ${C.grid}`, borderRadius: 14, background: "rgba(255,255,255,.96)", boxShadow: "0 9px 28px #17243b11" },
  kicker: { color: C.screen, fontSize: 11, fontWeight: 800, letterSpacing: ".07em" },
  h2: { margin: "5px 0 6px", fontSize: 20, letterSpacing: "-.05em" },
  intro: { minHeight: 55, margin: 0, color: C.muted, fontSize: 12, lineHeight: 1.5 },
  callout: { marginTop: 18, padding: "11px 12px", borderLeft: `3px solid ${C.virtual}`, borderRadius: "0 8px 8px 0", background: "#fff7f1", fontSize: 12, lineHeight: 1.45 },
  note: { margin: "12px 0 0", color: "#536178", fontSize: 11, lineHeight: 1.55 },
  footer: { margin: "0 40px 38px", padding: "12px 15px", border: `1px solid #b7d4d0`, borderRadius: 9, background: "#f0fbf9", color: "#405c5b", fontSize: 12, lineHeight: 1.5 },
};