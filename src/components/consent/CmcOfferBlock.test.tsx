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
