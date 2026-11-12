// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Button, SelectField } from "./ui";

/** [SLFD] SelectField: labelled select reporting the chosen value. */

afterEach(() => cleanup());

const OPTIONS = [
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
];

describe("[SLFD] SelectField", () => {
  it("[SLF1] renders the options under its label with the current value selected", () => {
    render(<SelectField id="lang" label="Language" value="fr" onChange={() => {}} options={OPTIONS} hint="Pick one" />);
    const select = screen.getByLabelText("Language") as HTMLSelectElement;
    expect(select.value).toBe("fr");
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["English", "French"]);
    expect(screen.getByText("Pick one")).toBeTruthy();
  });

  it("[SLF2] calls onChange with the chosen value", () => {
    const onChange = vi.fn();
    render(<SelectField id="lang" label="Language" value="en" onChange={onChange} options={OPTIONS} />);
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "fr" } });
    expect(onChange).toHaveBeenCalledWith("fr");
  });
});

describe("[UIBW] Button width", () => {
  it("[UIBW1] full width by default", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button", { name: "Go" }).className.split(/\s+/)).toContain("w-full");
  });

  it("[UIBW2] a caller's own width replaces the default, a responsive one keeps it", () => {
    render(<><Button className="w-auto">Auto</Button><Button className="sm:w-auto">Resp</Button></>);
    const auto = screen.getByRole("button", { name: "Auto" }).className.split(/\s+/);
    expect(auto).toContain("w-auto");
    expect(auto).not.toContain("w-full");
    expect(screen.getByRole("button", { name: "Resp" }).className.split(/\s+/)).toContain("w-full");
  });
});
