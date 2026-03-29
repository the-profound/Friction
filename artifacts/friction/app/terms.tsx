import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, Spacing, Typography } from "@/constants/tokens";

export default function TermsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
          <Feather name="chevron-left" size={24} color={Colors.zinc700} />
        </Pressable>
        <Text style={styles.headerTitle}>이용약관</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.meta}>시행일: 2026.03.29 · 버전: v0.1</Text>

        <Text style={styles.body}>
          본 약관은 "웅숭깊은 사람들"(이하 "서비스 제공자")이 제공하는 "Friction"(이하 "서비스")의 이용과 관련하여 서비스 제공자와 이용자 간 권리·의무 및 책임사항, 기타 필요한 사항을 규정합니다.
        </Text>

        <Divider />

        <Article title="제1조(목적)">
          본 약관은 서비스 제공자가 제공하는 서비스의 이용조건 및 절차, 서비스 제공자와 이용자 간의 권리·의무 및 책임사항, 기타 필요한 사항을 규정함을 목적으로 합니다.
        </Article>

        <Article title="제2조(정의)">
          {`1. "서비스 제공자"란 본 서비스를 운영·제공하는 주체로서, 법인 설립 전 단계의 예비창업팀/개인사업자/법인을 포함합니다.\n2. "서비스"란 서비스 제공자가 제공하는 웹/앱 및 이에 부수하는 제반 서비스를 말합니다.\n3. "이용자"란 본 약관에 따라 서비스에 접속하여 이용하는 회원 및 비회원을 말합니다.\n4. "회원"이란 서비스에 계정을 생성하고 본 약관에 동의하여 서비스 이용계약을 체결한 자를 말합니다.\n5. "비회원"이란 회원가입 없이 서비스의 일부 기능을 이용하는 자를 말합니다(서비스 정책에 따라 달라질 수 있습니다).\n6. "콘텐츠"란 회원이 서비스에 게시·업로드·전송·저장하는 글, 이미지, 링크, 파일, 댓글 등 일체의 정보를 말합니다.\n7. "유료서비스"란 서비스 제공자가 유료로 제공하는 구독, 아이템, 부가 기능 등 서비스를 말합니다.`}
        </Article>

        <Article title="제3조(약관의 효력 및 변경)">
          {`1. 본 약관은 이용자가 약관에 동의하고 서비스 제공자가 정한 절차에 따라 이용계약이 성립함으로써 효력이 발생합니다.\n2. 서비스 제공자는 관련 법령을 위반하지 않는 범위에서 본 약관을 변경할 수 있습니다.\n3. 서비스 제공자가 약관을 변경하는 경우, 적용일자 및 변경사유를 명시하여 적용일자 7일 전부터 공지합니다. 다만 이용자에게 불리한 변경은 30일 전부터 공지할 수 있습니다.\n4. 이용자가 변경된 약관에 동의하지 않는 경우 이용계약을 해지할 수 있으며, 변경 약관의 효력 발생일 이후에도 서비스를 계속 이용하는 경우 변경 약관에 동의한 것으로 봅니다.`}
        </Article>

        <Article title="제4조(이용계약의 성립)">
          {`1. 이용계약은 이용자가 약관에 동의하고, 서비스 제공자가 정한 가입절차(정보 입력, 인증 등)를 완료하며, 서비스 제공자가 이를 승낙함으로써 성립합니다.\n2. 서비스 제공자는 다음 각 호에 해당하는 신청에 대하여 승낙을 거절하거나 사후에 이용계약을 해지할 수 있습니다.\n  · 타인의 명의를 도용하거나 허위 정보를 기재한 경우\n  · 필수 정보를 기재하지 않거나 오기한 경우\n  · 법령 또는 본 약관을 위반할 우려가 큰 경우\n  · 서비스 운영상 또는 기술상 지장이 있는 경우`}
        </Article>

        <Article title="제5조(계정 및 회원정보의 관리)">
          {`1. 회원은 계정 정보(아이디, 비밀번호, 인증수단 등)를 본인 책임하에 관리해야 합니다.\n2. 회원의 관리 소홀, 제3자 이용, 도용 등으로 발생한 손해에 대한 책임은 회원에게 있습니다. 다만 서비스 제공자의 고의 또는 중대한 과실이 있는 경우는 예외로 합니다.\n3. 회원은 계정 도용 또는 보안 위반을 인지한 경우 지체 없이 서비스 제공자에 알려야 합니다.`}
        </Article>

        <Article title="제6조(서비스의 제공 및 변경)">
          {`1. 서비스 제공자는 이용자에게 다음 각 호의 서비스를 제공할 수 있습니다.\n  · 글/콘텐츠 작성, 저장, 발행 및 열람 기능\n  · 콘텐츠 추천, 검색, 분류 기능\n  · 커뮤니티/댓글/반응 등 상호작용 기능\n  · 기타 서비스 제공자가 정하는 기능\n2. 서비스 제공자는 서비스의 품질 개선, 운영상 필요, 기술적 사유 등으로 서비스 내용을 변경할 수 있습니다.\n3. 서비스 변경이 이용자에게 중대한 영향을 미치는 경우 서비스 제공자는 사전에 공지합니다.`}
        </Article>

        <Article title="제7조(서비스의 중단)">
          {`1. 서비스 제공자는 다음 각 호의 사유가 발생한 경우 서비스 제공을 일시적으로 중단할 수 있습니다.\n  · 설비 점검, 보수, 교체, 고장, 통신두절 등 기술상 사유\n  · 정전, 천재지변, 국가비상사태 등 불가항력\n  · 기타 운영상 필요\n2. 서비스 제공자는 서비스 중단이 예상되는 경우 사전에 공지하는 것을 원칙으로 하나, 긴급한 경우 사후 공지할 수 있습니다.`}
        </Article>

        <Article title="제8조(이용자의 의무)">
          {`1. 이용자는 서비스 이용과 관련하여 다음 행위를 해서는 안 됩니다.\n  · 타인의 정보 도용, 사칭\n  · 불법정보 게시(음란물, 불법촬영물, 아동·청소년 성착취물, 불법 도박 등)\n  · 혐오·차별·폭력·괴롭힘·협박 등 타인 권리 침해 또는 불쾌감을 주는 행위\n  · 저작권, 상표권 등 지식재산권 침해\n  · 스팸/광고성 게시물의 반복 게시, 도배\n  · 서비스의 정상적 운영을 방해하는 행위(자동화 스크립트/봇 악용, 취약점 공격 등)\n  · 서비스 제공자 또는 제3자의 명예, 신용, 재산 등 권리를 침해하는 행위\n2. 이용자는 관계 법령, 본 약관, 운영정책 및 서비스 제공자의 공지사항을 준수해야 합니다.`}
        </Article>

        <Article title="제9조(콘텐츠의 권리 및 이용허락)">
          {`1. 이용자가 서비스에 게시한 콘텐츠의 저작권은 원칙적으로 해당 이용자에게 귀속됩니다.\n2. 이용자는 서비스 운영, 제공, 개선 및 서비스 내 노출을 위해 서비스 제공자에 다음의 이용허락을 부여합니다.\n  · 전 세계 범위에서, 무상으로, 비독점적으로, 기간 제한 없이 콘텐츠를 저장, 복제, 전송, 공중송신, 전시, 배포, 2차적 저작물 작성(서비스 기능상 불가피한 범위의 포맷 변환/미리보기 생성 등)에 이용할 권리\n3. 이용자는 언제든지 콘텐츠를 삭제하거나 공개 범위를 변경할 수 있으며, 서비스 제공자는 관련 법령 및 기술적 한계 내에서 합리적인 기간 내 반영합니다.\n4. 서비스 제공자는 이용자가 콘텐츠에 대한 적법한 권리를 보유하지 않아 발생한 분쟁에 대해 책임을 지지 않으며, 이용자는 자신의 책임으로 이를 해결해야 합니다.`}
        </Article>

        <Article title="제10조(콘텐츠의 관리 및 게시 제한)">
          {`1. 서비스 제공자는 이용자의 콘텐츠가 법령 또는 본 약관을 위반하거나, 타인의 권리를 침해하거나, 서비스 운영정책에 반하는 경우 다음 조치를 할 수 있습니다.\n  · 게시물 삭제 또는 비공개 처리\n  · 콘텐츠 접근 제한\n  · 계정 이용정지 또는 해지\n2. 서비스 제공자는 필요한 경우 관련 법령에 따라 관계기관의 요청에 협조할 수 있습니다.`}
        </Article>

        <Article title="제11조(유료서비스 및 결제)">
          {`1. 서비스 제공자는 유료서비스를 제공할 수 있으며, 유료서비스의 내용, 가격, 결제방법, 이용기간 등은 결제 화면 및 별도 안내에 따릅니다.\n2. 구독형 서비스의 경우 결제는 정기적으로 자동 갱신될 수 있으며, 이용자는 서비스 제공자가 제공하는 방법으로 자동 갱신을 해지할 수 있습니다.\n3. 서비스 제공자는 관련 법령 및 결제사업자 정책에 따라 환불을 처리합니다. 환불 기준은 별도 환불정책 또는 결제 화면의 안내에 따를 수 있습니다.`}
        </Article>

        <Article title="제12조(계약해지 및 이용제한)">
          {`1. 회원은 언제든지 서비스 내 제공되는 방법을 통해 이용계약 해지를 신청할 수 있습니다.\n2. 서비스 제공자는 회원이 본 약관을 위반한 경우, 위반 정도에 따라 경고, 일시정지, 영구정지, 계약해지 등 이용제한 조치를 취할 수 있습니다.\n3. 이용계약 해지 시, 서비스 제공자는 관련 법령 및 개인정보처리방침에 따라 회원정보 및 콘텐츠를 처리합니다. 다만 법령상 보관의무가 있는 정보는 예외입니다.`}
        </Article>

        <Article title="제13조(개인정보의 보호)">
          서비스 제공자는 이용자의 개인정보를 보호하기 위해 관련 법령 및 서비스 제공자의 개인정보처리방침에 따라 개인정보를 처리합니다. 개인정보 처리에 관한 자세한 내용은 개인정보처리방침에서 확인할 수 있습니다.
        </Article>

        <Article title="제14조(면책)">
          {`1. 서비스 제공자는 천재지변, 불가항력, 이용자의 귀책사유로 인한 서비스 장애에 대하여 책임을 지지 않습니다.\n2. 서비스 제공자는 이용자가 서비스에 게시한 콘텐츠, 이용자 간 또는 이용자와 제3자 간 발생한 분쟁에 대해 개입하지 않으며, 이에 대한 책임을 지지 않습니다. 다만 서비스 제공자의 고의 또는 중대한 과실이 있는 경우는 예외로 합니다.\n3. 서비스 제공자는 무료로 제공되는 서비스의 이용과 관련하여 관련 법령에 특별한 규정이 없는 한 손해배상 책임을 지지 않습니다.`}
        </Article>

        <Article title="제15조(손해배상)">
          {`1. 서비스 제공자 또는 이용자가 본 약관을 위반하여 상대방에게 손해를 발생시킨 경우, 귀책사유가 있는 당사자는 그 손해를 배상해야 합니다.\n2. 서비스 제공자가 유료서비스와 관련하여 책임을 부담하는 경우, 법령상 허용되는 범위 내에서 책임을 제한할 수 있습니다.`}
        </Article>

        <Article title="제16조(분쟁해결)">
          {`1. 서비스 제공자는 이용자가 제기하는 불만 및 의견을 신속히 처리하기 위해 노력합니다.\n2. 서비스 제공자와 이용자 간 분쟁이 발생한 경우, 상호 협의하여 해결하는 것을 원칙으로 합니다.`}
        </Article>

        <Article title="제17조(준거법 및 관할)">
          {`1. 본 약관은 대한민국 법령에 따라 해석되고 이행됩니다.\n2. 서비스 제공자와 이용자 간 분쟁에 관한 소송은 민사소송법 등 관련 법령에 따른 관할법원에 제기합니다.`}
        </Article>

        <Divider />

        <Text style={styles.sectionLabel}>부칙</Text>
        <Text style={styles.body}>본 약관은 시행일로부터 적용됩니다.</Text>

        <Text style={styles.sectionLabel} accessibilityRole="none">서비스 제공자 정보</Text>
        <Text style={styles.body}>{`운영 주체: 웅숭깊은 사람들(예비창업팀)\n문의: team@the-profound.co.kr`}</Text>
      </ScrollView>
    </View>
  );
}

function Article({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.article}>
      <Text style={styles.articleTitle}>{title}</Text>
      <Text style={styles.body}>{children}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
    paddingVertical: 12,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.zinc100,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  headerSpacer: {
    width: 36,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 20,
    gap: 0,
  },
  meta: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
    marginBottom: 12,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.zinc100,
    marginVertical: 20,
  },
  article: {
    marginBottom: 20,
  },
  articleTitle: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc900,
    marginBottom: 6,
  },
  sectionLabel: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc900,
    marginBottom: 6,
    marginTop: 4,
  },
  body: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc600,
    lineHeight: 22,
  },
});
