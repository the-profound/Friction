import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, Spacing, Typography } from "@/constants/tokens";
import { useAuth } from "@/contexts/AuthContext";

type Mode = "login" | "signup";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { signInWithPassword, signUp } = useAuth();

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [signupDone, setSignupDone] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setErrorMessage(null);
    setPassword("");
    setPasswordConfirm("");
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

  async function handleSignUp() {
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
    setIsLoading(true);
    try {
      const { error, needsConfirmation } = await signUp(email.trim(), password);
      if (error) {
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
      } else if (needsConfirmation) {
        setSignupDone(true);
      }
    } catch {
      setErrorMessage("네트워크 오류가 발생했습니다. 인터넷 연결을 확인해주세요.");
    } finally {
      setIsLoading(false);
    }
  }

  const canSubmitLogin = email.trim().length > 0 && password.length > 0 && !isLoading;
  const canSubmitSignup = email.trim().length > 0 && password.length > 0 && passwordConfirm.length > 0 && !isLoading;

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
          <Feather name="book-open" size={56} color={Colors.zinc300} />
          <Text style={styles.title}>Friction</Text>
          <Text style={styles.subtitle}>읽고, 나누고, 연결하세요</Text>
        </View>

        <View style={styles.tabRow}>
          <Pressable
            style={[styles.tab, mode === "login" && styles.tabActive]}
            onPress={() => switchMode("login")}
          >
            <Text style={[styles.tabText, mode === "login" && styles.tabTextActive]}>로그인</Text>
          </Pressable>
          <Pressable
            style={[styles.tab, mode === "signup" && styles.tabActive]}
            onPress={() => switchMode("signup")}
          >
            <Text style={[styles.tabText, mode === "signup" && styles.tabTextActive]}>회원가입</Text>
          </Pressable>
        </View>

        {signupDone ? (
          <View style={styles.confirmBox}>
            <Feather name="mail" size={36} color={Colors.zinc900} />
            <Text style={styles.confirmTitle}>이메일을 확인해주세요</Text>
            <Text style={styles.confirmDesc}>
              <Text style={styles.confirmEmail}>{email.trim()}</Text>
              {"\n"}으로 인증 메일을 보냈어요.{"\n"}메일 내 링크를 클릭하면 가입이 완료됩니다.
            </Text>
            <Pressable
              style={styles.button}
              onPress={() => switchMode("login")}
            >
              <Text style={styles.buttonText}>로그인 화면으로</Text>
            </Pressable>
          </View>
        ) : (
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
                autoComplete={mode === "login" ? "password" : "new-password"}
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  if (errorMessage) setErrorMessage(null);
                }}
                onSubmitEditing={mode === "login" ? handleLogin : undefined}
                returnKeyType={mode === "login" ? "done" : "next"}
                editable={!isLoading}
              />
              <Pressable
                style={styles.eyeButton}
                onPress={() => setShowPassword((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
              >
                <Feather name={showPassword ? "eye-off" : "eye"} size={20} color={Colors.zinc400} />
              </Pressable>
            </View>

            {mode === "signup" && (
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
                  onSubmitEditing={handleSignUp}
                  returnKeyType="done"
                  editable={!isLoading}
                />
                <Pressable
                  style={styles.eyeButton}
                  onPress={() => setShowPasswordConfirm((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel={showPasswordConfirm ? "비밀번호 숨기기" : "비밀번호 보기"}
                >
                  <Feather name={showPasswordConfirm ? "eye-off" : "eye"} size={20} color={Colors.zinc400} />
                </Pressable>
              </View>
            )}

            {mode === "signup" && (
              <Text style={styles.hint}>비밀번호는 6자 이상이어야 합니다.</Text>
            )}

            {errorMessage ? (
              <Text style={styles.errorText}>{errorMessage}</Text>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.button,
                !(mode === "login" ? canSubmitLogin : canSubmitSignup) && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}
              onPress={mode === "login" ? handleLogin : handleSignUp}
              disabled={!(mode === "login" ? canSubmitLogin : canSubmitSignup)}
              accessibilityRole="button"
              accessibilityLabel={mode === "login" ? "로그인" : "회원가입"}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={styles.buttonText}>{mode === "login" ? "로그인" : "회원가입"}</Text>
              )}
            </Pressable>
          </View>
        )}
      </ScrollView>
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
  title: {
    ...Typography.headerTitle,
    fontSize: 36,
    color: Colors.zinc900,
    marginTop: 4,
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
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 11,
  },
  tabActive: {
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
    backgroundColor: Colors.zinc900,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonPressed: {
    opacity: 0.8,
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
});
