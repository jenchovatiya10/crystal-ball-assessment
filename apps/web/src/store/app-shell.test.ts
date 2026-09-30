import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAppShellStore } from "./app-shell";

describe("useAppShellStore", () => {
  beforeEach(() => {
    useAppShellStore.setState({ ready: false });
  });

  it("starts not ready and can mark ready", () => {
    const { result } = renderHook(() => useAppShellStore());

    expect(result.current.ready).toBe(false);

    act(() => {
      result.current.markReady();
    });

    expect(result.current.ready).toBe(true);
  });
});
