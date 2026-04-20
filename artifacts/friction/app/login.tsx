import { Feather } from "@expo/vector-icons";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, Spacing, Typography } from "@/constants/tokens";
import { useAuth } from "@/contexts/AuthContext";

type ScreenState = "input" | "otp";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { signInWithOtp, verifyEmailOtp } = useAuth();

  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [state, setState] = useState<ScreenState>("input");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const otpInputRef = useRef<TextInput>(null);

  async function handleSendCode() {
    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) {
      setErrorMessage("올바른 이메일 주소를 입력해주세요.");
      return;
    }

    setErrorMessage(null);
    setIsLoading(true);
    try {
      const { error } = await signInWithOtp(trimmed);
      if (error) {
        if (error.message.toLowerCase().includes("rate limit")) {
          setErrorMessage("잠시 후 다시 시도해주세요. (요청 한도 초과)");
        } else if (
          error.message.toLowerCase().includes("network") ||
          error.message.toLowerCase().includes("fetch")
        ) {
          setErrorMessage("네트워크 오류가 발생했습니다. 인터넷 연결을 확인해주세요.");
        } else {
          setErrorMessage("메일 발송에 실패했습니다. 다시 시도해주세요.");
        }
        return;
      }
      setOtp("");
      setState("otp");
      setTimeout(() => otpInputRef.current?.focus(), 300);
    } catch {
      setErrorMessage("네트워크 오류가 발생했습니다. 인터넷 연결을 확인해주세요.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleVerifyOtp() {
    const code = otp.trim();
    if (code.length !== 6) {
      setErrorMessage("6자리 코드를 입력해주세요.");
      return;
    }

    setErrorMessage(null);
    setIsLoading(true);
    try {
      const { error } = await verifyEmailOtp(email.trim(), code);
      if (error) {
        if (error.message.toLowerCase().includes("expired") || error.message.toLowerCase().includes("invalid")) {
          setErrorMessage("코드가 만료되었거나 올바르지 않아요. 다시 받아보세요.");
        } else {
          setErrorMessage("인증에 실패했습니다. 코드를 다시 확인해주세요.");
        }
      }
    } catch {
      setErrorMessage("네트워크 오류가 발생했습니다. 인터넷 연결을 확인해주세요.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleOtpChange(text: string) {
    const digits = text.replace(/[^0-9]/g, "").slice(0, 6);
    setOtp(digits);
    if (errorMessage) setErrorMessage(null);
    if (digits.length === 6) {
      setTimeout(() => handleVerifyOtpWithCode(digits), 100);
    }
  }

  async function handleVerifyOtpWithCode(code: string) {
    setErrorMessage(null);
    setIsLoading(true);
    try {
      const { error } = await verifyEmailOtp(email.trim(), code);
      if (error) {
        if (error.message.toLowerCase().includes("expired") || error.message.toLowerCase().includes("invalid")) {
          setErrorMessage("코드가 만료되었거나 올바르지 않아요. 다시 받아보세요.");
        } else {
          setErrorMessage("인증에 실패했습니다. 코드를 다시 확인해주세요.");
        }
      }
    } catch {
      setErrorMessage("네트워크 오류가 발생했습니다. 인터넷 연결을 확인해주세요.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleBack() {
    setState("input");
    setOtp("");
    setErrorMessage(null);
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View
        style={[
          styles.container,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        <View style={styles.content}>
          <Feather name="book-open" size={56} color={Colors.zinc300} />
          <Text style={styles.title}>Friction</Text>
          <Text style={styles.subtitle}>읽고, 나누고, 연결하세요</Text>

          {state === "input" ? (
            <View style={styles.formContainer}>
              <Text style={styles.formLabel}>이메일로 로그인</Text>
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
                onSubmitEditing={handleSendCode}
                returnKeyType="send"
                editable={!isLoading}
              />
              {errorMessage ? (
                <Text style={styles.errorText}>{errorMessage}</Text>
              ) : null}
              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  (isLoading || !email.trim()) && styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}
                onPress={handleSendCode}
                disabled={isLoading || !email.trim()}
                accessibilityRole="button"
                accessibilityLabel="인증 코드 받기"
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Text style={styles.buttonText}>인증 코드 받기</Text>
                )}
              </Pressable>
              <Text style={styles.hint}>
                이메일로 6자리 인증 코드가 발송됩니다. 비밀번호가 필요 없어요.
              </Text>
            </View>
          ) : (
            <View style={styles.formContainer}>
              <View style={styles.sentIconContainer}>
                <Feather name="mail" size={32} color={Colors.zinc900} />
              </View>
              <Text style={styles.sentTitle}>코드를 입력해주세요</Text>
              <Text style={styles.sentDescription}>
                <Text style={styles.sentEmail}>{email.trim()}</Text>
                {"\n"}으로 6자리 인증 코드를 보냈어요.{"\n"}이메일을 확인하고 코드를 입력하세요.
              </Text>

              <TextInput
                ref={otpInputRef}
                style={styles.otpInput}
                placeholder="000000"
                placeholderTextColor={Colors.zinc300}
                keyboardType="number-pad"
                maxLength={6}
                value={otp}
                onChangeText={handleOtpChange}
                editable={!isLoading}
                textAlign="center"
              />

              {errorMessage ? (
                <Text style={styles.errorText}>{errorMessage}</Text>
              ) : null}

              {isLoading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={Colors.zinc500} />
                  <Text style={styles.loadingText}>확인 중...</Text>
                </View>
              ) : null}

              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  (isLoading || otp.length !== 6) && styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}
                onPress={handleVerifyOtp}
                disabled={isLoading || otp.length !== 6}
                accessibilityRole="button"
                accessibilityLabel="로그인"
              >
                <Text style={styles.buttonText}>로그인</Text>
              </Pressable>

              <View style={styles.resendRow}>
                <Pressable
                  onPress={handleSendCode}
                  disabled={isLoading}
                  accessibilityRole="button"
                  accessibilityLabel="코드 재발송"
                >
                  <Text style={styles.resendText}>코드 재발송</Text>
                </Pressable>
                <Text style={styles.divider}>·</Text>
                <Pressable
                  onPress={handleBack}
                  disabled={isLoading}
                  accessibilityRole="button"
                  accessibilityLabel="이메일 변경"
                >
                  <Text style={styles.resendText}>이메일 변경</Text>
                </Pressable>
              </View>

              <Text style={styles.hint}>
                코드가 오지 않는다면 스팸함을 확인하거나 재발송을 눌러보세요.
              </Text>
            </View>
          )}
        </View>
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
    flex: 1,
    backgroundColor: Colors.white,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.screenPx,
    gap: 12,
  },
  title: {
    ...Typography.headerTitle,
    fontSize: 36,
    color: Colors.zinc900,
    marginTop: 16,
  },
  subtitle: {
    ...Typography.body,
    fontSize: 16,
    color: Colors.zinc500,
    textAlign: "center",
  },
  formContainer: {
    width: "100%",
    marginTop: 32,
    gap: 12,
    alignItems: "center",
  },
  formLabel: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc700,
    alignSelf: "flex-start",
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
  otpInput: {
    width: "100%",
    height: 64,
    borderWidth: 2,
    borderColor: Colors.zinc300,
    borderRadius: 14,
    ...Typography.bodySemiBold,
    fontSize: 32,
    letterSpacing: 8,
    color: Colors.zinc900,
    backgroundColor: Colors.white,
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
  hint: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc400,
    textAlign: "center",
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  sentIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  sentTitle: {
    ...Typography.bodySemiBold,
    fontSize: 20,
    color: Colors.zinc900,
    textAlign: "center",
  },
  sentDescription: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc500,
    textAlign: "center",
    lineHeight: 22,
  },
  sentEmail: {
    ...Typography.bodySemiBold,
    color: Colors.zinc700,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  loadingText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
  resendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  resendText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc600,
    textDecorationLine: "underline",
  },
  divider: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc400,
  },
});
