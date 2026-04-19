import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
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

type ScreenState = "input" | "sent";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { signInWithOtp } = useAuth();

  const [email, setEmail] = useState("");
  const [state, setState] = useState<ScreenState>("input");
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSend() {
    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) {
      setErrorMessage("올바른 이메일 주소를 입력해주세요.");
      return;
    }

    setErrorMessage(null);
    setIsSending(true);
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
        setState("input");
        return;
      }
      setState("sent");
    } catch {
      setErrorMessage("네트워크 오류가 발생했습니다. 인터넷 연결을 확인해주세요.");
      setState("input");
    } finally {
      setIsSending(false);
    }
  }

  function handleResend() {
    setState("input");
    setEmail("");
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
                onSubmitEditing={handleSend}
                returnKeyType="send"
                editable={!isSending}
              />
              {errorMessage ? (
                <Text style={styles.errorText}>{errorMessage}</Text>
              ) : null}
              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  (isSending || !email.trim()) && styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => handleSend()}
                disabled={isSending || !email.trim()}
                accessibilityRole="button"
                accessibilityLabel="Magic Link 보내기"
              >
                {isSending ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Text style={styles.buttonText}>Magic Link 보내기</Text>
                )}
              </Pressable>
              <Text style={styles.hint}>
                입력한 이메일로 로그인 링크가 발송됩니다. 비밀번호가 필요 없어요.
              </Text>
            </View>
          ) : (
            <View style={styles.formContainer}>
              <View style={styles.sentIconContainer}>
                <Feather name="mail" size={32} color={Colors.zinc900} />
              </View>
              <Text style={styles.sentTitle}>메일함을 확인하세요</Text>
              <Text style={styles.sentDescription}>
                <Text style={styles.sentEmail}>{email.trim()}</Text>
                {"\n"}으로 로그인 링크를 보냈어요.{"\n"}메일의 링크를 클릭하면 자동으로 로그인됩니다.
              </Text>
              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  isSending && styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => handleSend()}
                disabled={isSending}
                accessibilityRole="button"
                accessibilityLabel="같은 이메일로 재발송"
              >
                {isSending ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Text style={styles.buttonText}>같은 이메일로 재발송</Text>
                )}
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.resendButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={handleResend}
                accessibilityRole="button"
                accessibilityLabel="다른 이메일로 시도"
              >
                <Text style={styles.resendText}>다른 이메일로 시도</Text>
              </Pressable>
              <Text style={styles.hint}>
                메일이 오지 않는다면 스팸함을 확인하거나 잠시 후 다시 시도해보세요.
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
  resendButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: Colors.zinc200,
    borderRadius: 12,
    marginTop: 4,
  },
  resendText: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc700,
  },
});
