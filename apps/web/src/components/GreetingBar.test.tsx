import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GreetingBar } from "@/components/GreetingBar";

describe("GreetingBar", () => {
  it("renders presentational greeting chrome", () => {
    render(<GreetingBar />);
    expect(screen.getByRole("heading", { name: /replay greeting/i })).toBeInTheDocument();
  });
});
