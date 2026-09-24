// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SelectField } from "./ui";

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
