import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { subscribeToNetInfo } from "../safeNetInfo";

const appRoot = join(__dirname, "../..");
const rootLayout = readFileSync(join(appRoot, "app/_layout.tsx"), "utf8");
const safeNetInfo = readFileSync(join(appRoot, "lib/safeNetInfo.ts"), "utf8");

describe("NetInfo startup safety contract", () => {
  it("keeps the risky native module load inside the eager safe adapter", () => {
    expect(rootLayout).not.toContain('from "@react-native-community/netinfo"');
    expect(rootLayout).toContain('from "@/lib/safeNetInfo"');
    expect(rootLayout).toContain("onlineManager.setEventListener(subscribeToNetInfo)");
    expect(safeNetInfo).toContain('require("@react-native-community/netinfo")');
    expect(safeNetInfo).toContain("catch (err)");
  });

  it("assumes online and remains safely unsubscribable when NetInfo is unavailable", () => {
    const setOnline = vi.fn();

    const unsubscribe = subscribeToNetInfo(setOnline, null);

    expect(setOnline).toHaveBeenCalledWith(true);
    expect(() => unsubscribe()).not.toThrow();
  });

  it("forwards connectivity changes and returns NetInfo's unsubscribe function", () => {
    const setOnline = vi.fn();
    const unsubscribe = vi.fn();
    let listener: ((state: { isConnected: boolean | null }) => void) | undefined;
    const module = {
      addEventListener: vi.fn((nextListener) => {
        listener = nextListener;
        return unsubscribe;
      }),
    };

    const returnedUnsubscribe = subscribeToNetInfo(setOnline, module as never);
    listener?.({ isConnected: false });
    listener?.({ isConnected: true });
    returnedUnsubscribe();

    expect(setOnline).toHaveBeenNthCalledWith(1, false);
    expect(setOnline).toHaveBeenNthCalledWith(2, true);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("falls back online without throwing when listener registration fails", () => {
    const setOnline = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const module = {
      addEventListener: vi.fn(() => {
        throw new Error("RNCNetInfo listener unavailable");
      }),
    };

    expect(() => subscribeToNetInfo(setOnline, module as never)).not.toThrow();
    expect(setOnline).toHaveBeenCalledWith(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("assuming online"),
      expect.any(Error),
    );
    warn.mockRestore();
  });
});