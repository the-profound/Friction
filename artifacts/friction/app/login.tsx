import { Feather } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, Spacing, Typography } from "@/constants/tokens";
import { useAuth } from "@/contexts/AuthContext";

type Mode = "login" | "signup";
type SignupStep = 1 | 2;

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

const PRIVACY_URL = "https://friction.app/privacy";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signInWithPassword, signUp } = useAuth();

  const [mode, setMode] = useState<Mode>("login");
  const [signupStep, setSignupStep] = useState<SignupStep>(1);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [nickname, setNickname] = useState("");
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [agreedPrivacy, setAgreedPrivacy] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [signupDone, setSignupDone] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setSignupStep(1);
    setErrorMessage(null);
    setPassword("");
    setPasswordConfirm("");
    setNickname("");
    setAgreedTerms(false);
    setAgreedPrivacy(false);
    setShowPassword(false);
    setShowPasswordConfirm(false);
    setSignupDone(false);
  }

  async function handleLogin() {
    if (!isValidEmail(email)) {
      setErrorMessage("올바른 이메일 주소를 입력해주세요.");
      return;
    }
    if (!password) {
      setErrorMessage("비밀번호를 입력해주세요.");
      return;
    }
    setErrorMessage(null);
    setIsLoading(true);
    try {
      const { error } = await signInWithPassword(email.trim(), password);
      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("invalid login credentials") || msg.includes("invalid credentials")) {
          setErrorMessage("이메일 또는 비밀번호가 올바르지 않아요.");
        } else if (msg.includes("email not confirmed")) {
          setErrorMessage("이메일 인증이 완료되지 않은 계정이에요. 메일함을 확인해주세요.");
        } else if (msg.includes("network") || msg.includes("fetch")) {
          setErrorMessage("네트워크 오류가 발생했습니다. 인터넷 연결을 확인해주세요.");
        } else {
          setErrorMessage("로그인에 실패했습니다. 다시 시도해주세요.");
        }
      }
    } catch {
      setErrorMessage("네트워크 오류가 발생했습니다. 인터넷 연결을 확인해주세요.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleSignUpStep1() {
    if (!isValidEmail(email)) {
      setErrorMessage("올바른 이메일 주소를 입력해주세요.");
      return;
    }
    if (password.length < 6) {
      setErrorMessage("비밀번호는 6자 이상이어야 합니다.");
      return;
    }
    if (password !== passwordConfirm) {
      setErrorMessage("비밀번호가 일치하지 않아요.");
      return;
    }
    setErrorMessage(null);
    setSignupStep(2);
  }

  async function handleSignUpStep2() {
    const trimmedNickname = nickname.trim();
    if (!trimmedNickname) {
      setErrorMessage("이름(닉네임)을 입력해주세요.");
      return;
    }
    if (trimmedNickname.length > 20) {
      setErrorMessage("이름은 20자 이내로 입력해주세요.");
      return;
    }
    if (!agreedTerms || !agreedPrivacy) {
      setErrorMessage("서비스 이용약관과 개인정보 처리방침에 동의해주세요.");
      return;
    }
    setErrorMessage(null);
    setIsLoading(true);
    try {
      const { error, needsConfirmation } = await signUp(email.trim(), password, trimmedNickname);
      if (error) {
        if (error.name === "UserSyncError") {
          // Account creation itself succeeded on Supabase's side, but the
          // profile row failed to sync to our backend. AuthContext already
          // signed the user back out if they had been auto-confirmed, so it's
          // always safe to let them retry from here.
          setErrorMessage("계정은 생성됐지만 프로필 저장에 실패했습니다. 다시 시도해주세요.");
        } else {
          const msg = error.message.toLowerCase();
          if (msg.includes("already registered") || msg.includes("already exists") || msg.includes("user already")) {
            setErrorMessage("이미 가입된 이메일입니다. 로그인해주세요.");
          } else if (msg.includes("network") || msg.includes("fetch")) {
            setErrorMessage("네트워크 오류가 발생했습니다. 인터넷 연결을 확인해주세요.");
          } else if (msg.includes("password")) {
            setErrorMessage("비밀번호는 6자 이상이어야 합니다.");
          } else {
            setErrorMessage("회원가입에 실패했습니다. 다시 시도해주세요.");
          }
        }
      } else if (needsConfirmation) {
        setSignupDone(true);
      }
    } catch {
      setErrorMessage("네트워크 오류가 발생했습니다. 인터넷 연결을 확인해주세요.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDevLogin() {
    setIsLoading(true);
    try {
      await signInWithPassword("minji@test.com", "00000000");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleHyeonjunLogin() {
    setIsLoading(true);
    try {
      await signInWithPassword("mrglassjelly@gmail.com", "rhdckdrud1emd");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleIlgonLogin() {
    setIsLoading(true);
    try {
      await signInWithPassword("thomthiswld@gmail.com", "Cham1234");
    } finally {
      setIsLoading(false);
    }
  }

  const canSubmitLogin = email.trim().length > 0 && password.length > 0 && !isLoading;
  const canSubmitSignupStep1 =
    email.trim().length > 0 && password.length > 0 && passwordConfirm.length > 0 && !isLoading;
  const canSubmitSignupStep2 =
    nickname.trim().length > 0 && agreedTerms && agreedPrivacy && !isLoading;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Image
            source={require("../assets/images/splash-icon.png")}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.subtitle}>읽고, 나누고, 연결하세요</Text>
        </View>

        <View style={styles.tabRow}>
          <ScalePressable
            style={styles.tab}
            contentStyle={[styles.tabContent, mode === "login" && styles.tabActiveContent]}
            onPress={() => switchMode("login")}
          >
            <Text style={[styles.tabText, mode === "login" && styles.tabTextActive]}>로그인</Text>
          </ScalePressable>
          <ScalePressable
            style={styles.tab}
            contentStyle={[styles.tabContent, mode === "signup" && styles.tabActiveContent]}
            onPress={() => switchMode("signup")}
          >
            <Text style={[styles.tabText, mode === "signup" && styles.tabTextActive]}>회원가입</Text>
          </ScalePressable>
        </View>

        {signupDone ? (
          <View style={styles.confirmBox}>
            <Feather name="mail" size={36} color={Colors.zinc900} />
            <Text style={styles.confirmTitle}>이메일을 확인해주세요</Text>
            <Text style={styles.confirmDesc}>
              <Text style={styles.confirmEmail}>{email.trim()}</Text>
              {"\n"}으로 인증 메일을 보냈어요.{"\n"}메일 내 링크를 클릭하면 가입이 완료됩니다.
            </Text>
            <ScalePressable
              style={styles.button}
              contentStyle={styles.buttonContent}
              onPress={() => switchMode("login")}
            >
              <Text style={styles.buttonText}>로그인 화면으로</Text>
            </ScalePressable>
          </View>
        ) : mode === "login" ? (
          <View style={styles.formContainer}>
            <TextInput
              style={styles.input}
              placeholder="이메일 주소"
              placeholderTextColor={Colors.zinc400}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                if (errorMessage) setErrorMessage(null);
              }}
              returnKeyType="next"
              editable={!isLoading}
            />

            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                placeholder="비밀번호"
                placeholderTextColor={Colors.zinc400}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="password"
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  if (errorMessage) setErrorMessage(null);
                }}
                onSubmitEditing={handleLogin}
                returnKeyType="done"
                editable={!isLoading}
              />
              <ScalePressable
                style={styles.eyeButton}
                contentStyle={styles.eyeButtonContent}
                onPress={() => setShowPassword((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
              >
                <Feather name={showPassword ? "eye-off" : "eye"} size={20} color={Colors.zinc400} />
              </ScalePressable>
            </View>

            {errorMessage ? (
              <Text style={styles.errorText}>{errorMessage}</Text>
            ) : null}

            <ScalePressable
              style={styles.button}
              contentStyle={[
                styles.buttonContent,
                !canSubmitLogin && styles.buttonDisabledContent,
              ]}
              onPress={handleLogin}
              disabled={!canSubmitLogin}
              accessibilityRole="button"
              accessibilityLabel="로그인"
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={styles.buttonText}>로그인</Text>
              )}
            </ScalePressable>
          </View>
        ) : signupStep === 1 ? (
          <View style={styles.formContainer}>
            <TextInput
              style={styles.input}
              placeholder="이메일 주소"
              placeholderTextColor={Colors.zinc400}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                if (errorMessage) setErrorMessage(null);
              }}
              returnKeyType="next"
              editable={!isLoading}
            />

            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                placeholder="비밀번호"
                placeholderTextColor={Colors.zinc400}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  if (errorMessage) setErrorMessage(null);
                }}
                returnKeyType="next"
                editable={!isLoading}
              />
              <ScalePressable
                style={styles.eyeButton}
                contentStyle={styles.eyeButtonContent}
                onPress={() => setShowPassword((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
              >
                <Feather name={showPassword ? "eye-off" : "eye"} size={20} color={Colors.zinc400} />
              </ScalePressable>
            </View>

            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                placeholder="비밀번호 확인"
                placeholderTextColor={Colors.zinc400}
                secureTextEntry={!showPasswordConfirm}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                value={passwordConfirm}
                onChangeText={(text) => {
                  setPasswordConfirm(text);
                  if (errorMessage) setErrorMessage(null);
                }}
                onSubmitEditing={handleSignUpStep1}
                returnKeyType="done"
                editable={!isLoading}
              />
              <ScalePressable
                style={styles.eyeButton}
                contentStyle={styles.eyeButtonContent}
                onPress={() => setShowPasswordConfirm((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={showPasswordConfirm ? "비밀번호 숨기기" : "비밀번호 보기"}
              >
                <Feather name={showPasswordConfirm ? "eye-off" : "eye"} size={20} color={Colors.zinc400} />
              </ScalePressable>
            </View>

            <Text style={styles.hint}>비밀번호는 6자 이상이어야 합니다.</Text>

            {errorMessage ? (
              <Text style={styles.errorText}>{errorMessage}</Text>
            ) : null}

            <ScalePressable
              style={styles.button}
              contentStyle={[
                styles.buttonContent,
                !canSubmitSignupStep1 && styles.buttonDisabledContent,
              ]}
              onPress={handleSignUpStep1}
              disabled={!canSubmitSignupStep1}
              accessibilityRole="button"
              accessibilityLabel="다음"
            >
              <Text style={styles.buttonText}>다음</Text>
            </ScalePressable>
          </View>
        ) : (
          <View style={styles.formContainer}>
            <ScalePressable
              style={styles.backRow}
              contentStyle={styles.backRowContent}
              onPress={() => {
                setSignupStep(1);
                setErrorMessage(null);
              }}
            >
              <Feather name="arrow-left" size={16} color={Colors.zinc500} />
              <Text style={styles.backRowText}>이전 단계로</Text>
            </ScalePressable>

            <TextInput
              style={styles.input}
              placeholder="이름(닉네임)"
              placeholderTextColor={Colors.zinc400}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
              value={nickname}
              onChangeText={(text) => {
                setNickname(text);
                if (errorMessage) setErrorMessage(null);
              }}
              returnKeyType="done"
              editable={!isLoading}
            />
            <Text style={styles.hint}>이웃 검색 시 표시되는 이름입니다. (최대 20자)</Text>

            <View style={styles.agreementBox}>
              <View style={styles.checkRow}>
                <ScalePressable
                  onPress={() => setAgreedTerms((v) => !v)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: agreedTerms }}
                  hitSlop={8}
                >
                  <View style={[styles.checkbox, agreedTerms && styles.checkboxChecked]}>
                    {agreedTerms && <Feather name="check" size={13} color={Colors.white} />}
                  </View>
                </ScalePressable>
                <Text style={styles.checkLabel} onPress={() => setAgreedTerms((v) => !v)}>
                  {"(필수) "}
                  <Text
                    style={styles.checkLink}
                    onPress={(e) => { e.stopPropagation(); router.push("/terms"); }}
                  >
                    서비스 이용약관
                  </Text>
                  {"에 동의합니다"}
                </Text>
              </View>

              <View style={styles.checkRow}>
                <ScalePressable
                  onPress={() => setAgreedPrivacy((v) => !v)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: agreedPrivacy }}
                  hitSlop={8}
                >
                  <View style={[styles.checkbox, agreedPrivacy && styles.checkboxChecked]}>
                    {agreedPrivacy && <Feather name="check" size={13} color={Colors.white} />}
                  </View>
                </ScalePressable>
                <Text style={styles.checkLabel} onPress={() => setAgreedPrivacy((v) => !v)}>
                  {"(필수) "}
                  <Text
                    style={styles.checkLink}
                    onPress={(e) => { e.stopPropagation(); Linking.openURL(PRIVACY_URL); }}
                  >
                    개인정보 처리방침
                  </Text>
                  {"에 동의합니다"}
                </Text>
              </View>
            </View>

            {errorMessage ? (
              <Text style={styles.errorText}>{errorMessage}</Text>
            ) : null}

            <ScalePressable
              style={styles.button}
              contentStyle={[
                styles.buttonContent,
                !canSubmitSignupStep2 && styles.buttonDisabledContent,
              ]}
              onPress={handleSignUpStep2}
              disabled={!canSubmitSignupStep2}
              accessibilityRole="button"
              accessibilityLabel="가입 완료"
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={styles.buttonText}>가입 완료</Text>
              )}
            </ScalePressable>
          </View>
        )}
      </ScrollView>
      <View style={[styles.devButtonRow, { bottom: insets.bottom + 12 }]}>
        <ScalePressable
          style={styles.devButton}
          contentStyle={styles.devButtonContent}
          onPress={handleDevLogin}
          disabled={isLoading}
        >
          <Text style={styles.devButtonText}>민지</Text>
        </ScalePressable>
        <ScalePressable
          style={styles.devButton}
          contentStyle={styles.devButtonContent}
          onPress={handleHyeonjunLogin}
          disabled={isLoading}
        >
          <Text style={styles.devButtonText}>현준</Text>
        </ScalePressable>
        <ScalePressable
          style={styles.devButton}
          contentStyle={styles.devButtonContent}
          onPress={handleIlgonLogin}
          disabled={isLoading}
        >
          <Text style={styles.devButtonText}>일곤</Text>
        </ScalePressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  container: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.screenPx,
    gap: 0,
  },
  header: {
    alignItems: "center",
    gap: 12,
    marginBottom: 36,
  },
  logo: {
    width: 120,
    height: 120,
  },
  subtitle: {
    ...Typography.body,
    fontSize: 16,
    color: Colors.zinc500,
    textAlign: "center",
  },
  tabRow: {
    flexDirection: "row",
    width: "100%",
    borderRadius: 14,
    backgroundColor: Colors.zinc100,
    padding: 4,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
  },
  tabContent: {
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 11,
  },
  tabActiveContent: {
    backgroundColor: Colors.white,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc400,
  },
  tabTextActive: {
    ...Typography.bodySemiBold,
    color: Colors.zinc900,
  },
  formContainer: {
    width: "100%",
    gap: 12,
    alignItems: "center",
  },
  input: {
    width: "100%",
    height: 52,
    borderWidth: 1.5,
    borderColor: Colors.zinc200,
    borderRadius: 14,
    paddingHorizontal: 16,
    ...Typography.body,
    fontSize: 16,
    color: Colors.zinc900,
    backgroundColor: Colors.white,
  },
  passwordContainer: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: Colors.zinc200,
    borderRadius: 14,
    backgroundColor: Colors.white,
    height: 52,
  },
  passwordInput: {
    flex: 1,
    height: "100%",
    paddingHorizontal: 16,
    ...Typography.body,
    fontSize: 16,
    color: Colors.zinc900,
  },
  eyeButton: {
    height: "100%",
  },
  eyeButtonContent: {
    paddingHorizontal: 14,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  hint: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc400,
    alignSelf: "flex-start",
  },
  errorText: {
    ...Typography.caption,
    fontSize: 13,
    color: "#DC2626",
    alignSelf: "flex-start",
  },
  button: {
    width: "100%",
    height: 52,
    marginTop: 4,
  },
  buttonContent: {
    height: "100%",
    backgroundColor: Colors.zinc900,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabledContent: {
    opacity: 0.45,
  },
  buttonText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },
  confirmBox: {
    width: "100%",
    alignItems: "center",
    gap: 16,
    paddingTop: 8,
  },
  confirmTitle: {
    ...Typography.bodySemiBold,
    fontSize: 20,
    color: Colors.zinc900,
    textAlign: "center",
  },
  confirmDesc: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc500,
    textAlign: "center",
    lineHeight: 22,
  },
  confirmEmail: {
    ...Typography.bodySemiBold,
    color: Colors.zinc700,
  },
  backRow: {
    alignSelf: "flex-start",
  },
  backRowContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  backRowText: {
    ...Typography.caption,
    fontSize: 14,
    color: Colors.zinc500,
  },
  agreementBox: {
    width: "100%",
    gap: 10,
    paddingVertical: 4,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: Colors.zinc300,
    backgroundColor: Colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: Colors.zinc900,
    borderColor: Colors.zinc900,
  },
  checkLabel: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc600,
    flex: 1,
  },
  checkLink: {
    ...Typography.bodySemiBold,
    color: Colors.zinc900,
    textDecorationLine: "underline",
  },
  devButtonRow: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
  },
  devButton: {
  },
  devButtonContent: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: "center",
  },
  devButtonText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc900,
  },
});
