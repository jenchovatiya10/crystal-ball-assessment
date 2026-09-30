import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import HomePage from "@/app/page";

describe("HomePage", () => {
  it("renders foundation placeholder", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { name: /foundation ready/i })).toBeInTheDocument();
  });
});
