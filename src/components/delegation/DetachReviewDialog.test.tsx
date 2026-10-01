// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DetachReviewDialog } from "./DetachReviewDialog";
import type { ConsentGrantReview } from "../../lib/delegation";

/** The review of the consents a delegate gave, before it is removed. */

const grant = (accessId: string, requester: string): ConsentGrantReview => ({
  accessId,
  requester,
  permissions: [{ streamId: "diary", level: "read" }],
  givenOnText: "1/1/2026",
  approvedBy: "parent",
  acceptEventId: "ev-" + accessId,
  delivered: true,
});

function renderDialog(onConfirm = vi.fn(), onCancel = vi.fn()) {
  render(
    <DetachReviewDialog
      username="parent"
      grants={[grant("g1", "doctor"), grant("g2", "study")]}
      busy={false}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { onConfirm, onCancel, confirm: screen.getByRole("button", { name: "Remove delegate" }) };
}

describe("detach review dialog", () => {
  afterEach(() => cleanup());

  it("[DKP2] lists every consent with nothing chosen, and Remove stays disabled until each has a decision", () => {
    const { confirm } = renderDialog();
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
    expect(screen.getAllByTestId("detach-review-grant")).toHaveLength(2);
    expect(screen.getAllByTestId("detach-review-grant")[0].textContent).toContain("Requested by doctor");
    expect(screen.getAllByText(/Approved by parent/)).toHaveLength(2);
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios).toHaveLength(4);
    expect(radios.every((r) => !r.checked)).toBe(true);
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(radios[0]);
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(radios[3]);
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  });

  it("[DKP3] confirms with the ids of the consents kept, and Escape cancels", () => {
    const { onConfirm, onCancel, confirm } = renderDialog();
    const [keepG1, , , dropG2] = screen.getAllByRole("radio");
    fireEvent.click(keepG1);
    fireEvent.click(dropG2);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith(["g1"]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("[DKP7] a consent never delivered offers no Keep and is withdrawn", () => {
    const onConfirm = vi.fn();
    render(
      <DetachReviewDialog
        username="parent"
        grants={[grant("g1", "doctor"), { ...grant("g2", "study"), delivered: false }]}
        busy={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const rows = screen.getAllByTestId("detach-review-grant");
    expect(rows[1].textContent).toContain("Not delivered");
    expect(rows[1].querySelectorAll("input[type=radio]")).toHaveLength(0);
    const confirm = screen.getByRole("button", { name: "Remove delegate" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("radio")[0]);
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith(["g1"]);
  });
});
