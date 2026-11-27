// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CurrentValidationLine } from "./CurrentValidation";

/**
 * [CVLN] The level stamped at consent next to the current one, with a notice
 * when the app is no longer served or its level changed; nothing without a
 * current level (a core without the route).
 */

afterEach(() => cleanup());

const cur = (level: "nonValidated" | "publisherValidated" | "appValidated", served = true) => ({ level, publisher: null, validatedAt: null, served });

describe("[CVLN] current validation line", () => {
  it("[CVLN1] both levels, no notice when unchanged", () => {
    render(<CurrentValidationLine stamped="appValidated" current={cur("appValidated")} />);
    expect(screen.getByTestId("current-validation").textContent).toContain("Validation at consent: App Validated");
    expect(screen.getByTestId("current-validation-level").textContent).toBe("Current validation: App Validated");
    expect(screen.queryByTestId("current-validation-notice")).toBeNull();
  });

  it("[CVLN2] lower since consent: a warning", () => {
    render(<CurrentValidationLine stamped="appValidated" current={cur("nonValidated")} />);
    const notice = screen.getByTestId("current-validation-notice");
    expect(notice.textContent).toBe("This application lost validation since you allowed it.");
    expect(notice.getAttribute("role")).toBe("alert");
  });

  it("[CVLN3] no longer served: a warning, whatever the level", () => {
    render(<CurrentValidationLine stamped="publisherValidated" current={cur("publisherValidated", false)} />);
    expect(screen.getByTestId("current-validation-notice").textContent).toContain("The platform no longer serves this application");
  });

  it("[CVLN4] higher since consent: information, not a warning", () => {
    render(<CurrentValidationLine stamped="nonValidated" current={cur("appValidated")} />);
    const notice = screen.getByTestId("current-validation-notice");
    expect(notice.textContent).toBe("This application was validated further since you allowed it.");
    expect(notice.getAttribute("role")).toBeNull();
  });

  it("[CVLN5] no stamp (a grant made before the core stamped it): the current level only", () => {
    render(<CurrentValidationLine stamped={null} current={cur("publisherValidated")} />);
    expect(screen.getByTestId("current-validation").textContent).toBe("Current validation: Publisher Validated");
  });

  it("[CVLN6] no current level: nothing", () => {
    const { container } = render(<CurrentValidationLine stamped="appValidated" current={null} />);
    expect(container.innerHTML).toBe("");
  });
});
