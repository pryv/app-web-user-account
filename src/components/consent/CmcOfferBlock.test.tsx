// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

/** [COBK] One cross-account offer block: the requester's consent statement. */

import { CmcOfferBlock, type CmcOfferView } from "./CmcOfferBlock";
import i18n from "../../i18n";

function offer(consent: Record<string, string>): CmcOfferView {
  return {
    requester: { username: "carer", host: "pryv.me" },
    requestedPermissions: [],
    consent,
    mode: "invite",
  };
}

function renderBlock(consent: Record<string, string>) {
  render(
    <CmcOfferBlock
      offer={offer(consent)}
      loading={false}
      error={null}
      busy={null}
      onApprove={() => {}}
      onDecline={() => {}}
    />,
  );
  return screen.getByTestId("cmc-consent-text").textContent;
}

describe("[COBK] CmcOfferBlock consent statement", () => {
  const original = i18n.language;
  afterEach(() => {
    cleanup();
    i18n.language = original;
  });

  it("[COB1] shows the statement in the interface language, not the first one listed", () => {
    // Set directly: the build ships English only, so changeLanguage() cannot
    // select another code.
    i18n.language = "fr";
    expect(renderBlock({ en: "I agree", fr: "J'accepte" })).toBe("J'accepte");
  });

  it("[COB2] falls back from a regional language to its base, then to English", () => {
    i18n.language = "fr-CH";
    expect(renderBlock({ en: "I agree", fr: "J'accepte" })).toBe("J'accepte");
    cleanup();
    i18n.language = "de";
    expect(renderBlock({ fr: "J'accepte", en: "I agree" })).toBe("I agree");
  });

  it("[COB3] shows no statement when the offer carries none", () => {
    i18n.language = "en";
    render(
      <CmcOfferBlock
        offer={offer({})}
        loading={false}
        error={null}
        busy={null}
        onApprove={() => {}}
        onDecline={() => {}}
      />,
    );
    expect(screen.queryByTestId("cmc-consent-text")).toBeNull();
  });
});

describe("[COBD] CmcOfferBlock: delegable and membership offers", () => {
  afterEach(() => cleanup());

  function renderOffer(extra: Partial<CmcOfferView>) {
    render(
      <CmcOfferBlock
        offer={{ ...offer({}), requestedPermissions: [{ streamId: ":_cmc:apps:practice:team-a", level: "contribute" }], ...extra }}
        loading={false}
        error={null}
        busy={null}
        onApprove={() => {}}
        onDecline={() => {}}
      />,
    );
  }

  it("[COB4] a delegable offer (accessType 'app') says so, before the actions", () => {
    renderOffer({ accessType: "app" });
    const notice = screen.getByTestId("cmc-delegable-notice");
    expect(notice.textContent).toBe(
      "This organisation can share this access with its team members. Each member's actions are recorded on your account.",
    );
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(notice.compareDocumentPosition(approve) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("[COB5] no notice for a shared offer, or when the client does not say", () => {
    renderOffer({ accessType: "shared" });
    expect(screen.queryByTestId("cmc-delegable-notice")).toBeNull();
    cleanup();
    renderOffer({});
    expect(screen.queryByTestId("cmc-delegable-notice")).toBeNull();
  });

  it("[COB7] a feature restriction reads as a locked \"The app cannot …\" line, never a choice", () => {
    renderOffer({
      requestedPermissions: [
        { streamId: "diary", level: "read" },
        { feature: "webhooks", setting: "forbidden", optIn: true },
        { feature: "exports", setting: "forbidden" },
      ],
    });
    expect(screen.getByText(/The app cannot register webhooks/)).toBeTruthy();
    expect(screen.getByText("The app cannot use “exports”")).toBeTruthy();
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });

  it("[COB6] a membership offer reads as a request to join the group, not as a data grant", () => {
    renderOffer({ membership: true });
    expect(screen.getByText(/asks to join this account's group as a member/)).toBeTruthy();
    expect(screen.queryByText(/is requesting access/)).toBeNull();
    expect(screen.getByTestId("cmc-membership-notice").textContent).toContain("not a request for your data");
    cleanup();
    renderOffer({ membership: false });
    expect(screen.getByText(/is requesting access/)).toBeTruthy();
    expect(screen.queryByTestId("cmc-membership-notice")).toBeNull();
  });
});
