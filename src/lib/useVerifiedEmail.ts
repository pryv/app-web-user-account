/**
 * The email address of the accounts a consent screen is about, followed until
 * it is verified: shared by `/auth` and `/cmc-accept`.
 *
 * Keyed by the token-bearing endpoint of each account, so every consent on one
 * account shares one read, one added address and one proof. A consent that
 * requires a verified address cannot be approved until the state is `proved`;
 * one that only reads the address is told when there is none.
 *
 * The proof usually happens on another device (a mailed link): while a link is
 * waited for, the account is read every few seconds as long as the page is
 * visible, and once when it gets the focus back. An account that leaves the
 * page (account switch, unmount) is forgotten, and its late answers dropped.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { loggableError } from "./apiError";
import { registrationRequiresVerifiedEmail, verificationOnAccount, type ServiceInfoFeatures } from "./emailVerification";
import {
  addAccountEmail,
  emailEntry,
  emailRefusal,
  hasUsableEmail,
  isProvedEmail,
  PLACEHOLDER_EMAIL,
  primaryEmailOf,
  readAccountEmails,
  removeAccountEmail,
  resendVerificationEmail,
  setAccountEmail,
  setPrimaryEmail,
  type AccountEmails,
} from "./accountEmail";

/** How often the account is read while a mailed link is waited for. */
export const PROOF_POLL_MS = 4000;

/**
 * When "Send again" is offered after a mail. The platform's own cooldown
 * decides: it is not known here, and its refusal says how long is left.
 */
export const SEND_AGAIN_AFTER_MS = 60_000;

/** Longest delay a browser timer takes. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Where the address of one account stands. `viaAdd`: the address is one being
 * added to the account, not its primary one.
 */
export type VerifiedEmailState =
  | { kind: "checking" }
  /** `here`: the address became the account's on this page. */
  | { kind: "proved"; email: string; here: boolean }
  | { kind: "unproved"; email: string }
  /** `suggested`: an address the account already holds, besides its primary one. */
  | { kind: "missing"; suggested: string | null }
  | { kind: "adding" }
  /** Set without a proof, on a platform that asks for none. */
  | { kind: "added"; email: string }
  | { kind: "sending"; email: string; viaAdd: boolean }
  | { kind: "waiting"; email: string; viaAdd: boolean; canSendAgain: boolean }
  /** `until`: when the next mail can be asked for (epoch seconds). `sent`: one was sent, its link may still come. */
  | { kind: "cooldown"; email: string; viaAdd: boolean; until: number; sent: boolean }
  | { kind: "taken"; viaAdd: boolean }
  | { kind: "unavailable" }
  | { kind: "error"; at: "read" | "send" | "add"; viaAdd: boolean; message: string };

/** One consent's interest in an account's address. */
export interface EmailRequest {
  /** The account's token-bearing endpoint. */
  endpoint: string;
  /** The consent requires a verified address (otherwise it only reads the address). */
  required: boolean;
}

export interface VerifiedEmail {
  /** The state to show for a consent on the account behind `endpoint`. */
  stateOf(endpoint: string | null, required: boolean): VerifiedEmailState;
  /** Whether the account behind `endpoint` has a verified address, as last read. */
  proved(endpoint: string | null): boolean;
  /** An address is being written to one of the accounts. */
  adding: boolean;
  /** Add an address to the account (to verify it, where a proof is asked for). */
  add(endpoint: string, email: string): Promise<void>;
  /** Mail the verification link of the address being shown. */
  send(endpoint: string): Promise<void>;
  /** Leave the address being waited for, to type another one. */
  change(endpoint: string): void;
  /** Read the account again; resolves to whether its address is verified. */
  recheck(endpoint: string | null): Promise<boolean>;
}

/** One followed account. A new object each time the account (re)enters the page. */
interface Track {
  state: VerifiedEmailState;
  account: AccountEmails | null;
  /** The address a mail was asked for here: made primary once verified. */
  target: string | null;
  /** The address became the account's on this page. */
  here: boolean;
  /** The latest read; an older one's answer is dropped. */
  readSeq: number;
  reading: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

const CHECKING: VerifiedEmailState = { kind: "checking" };

/** A mailed link may be opened at any moment. */
function awaitsProof(state: VerifiedEmailState): boolean {
  return state.kind === "waiting" || state.kind === "cooldown";
}

/**
 * Follow the accounts of `requests`. `serviceInfo` is the platform's (null
 * while it is read; `{}` when it cannot be). `logLabel` names the page in the
 * console.
 */
export function useVerifiedEmail(
  requests: readonly EmailRequest[],
  serviceInfo: ServiceInfoFeatures | null,
  logLabel: string,
): VerifiedEmail {
  const { t } = useTranslation();
  const tracks = useRef(new Map<string, Track>());
  const [states, setStates] = useState<Record<string, VerifiedEmailState>>({});

  const isLive = (endpoint: string, track: Track) => tracks.current.get(endpoint) === track;

  function put(endpoint: string, track: Track, state: VerifiedEmailState) {
    if (!isLive(endpoint, track)) return;
    if (track.timer != null) clearTimeout(track.timer);
    track.timer = null;
    track.state = state;
    if (state.kind === "waiting" && !state.canSendAgain) {
      track.timer = setTimeout(() => put(endpoint, track, { ...state, canSendAgain: true }), SEND_AGAIN_AFTER_MS);
    } else if (state.kind === "cooldown") {
      const { email, viaAdd, until, sent } = state;
      const after: VerifiedEmailState =
        sent || viaAdd ? { kind: "waiting", email, viaAdd, canSendAgain: true } : { kind: "unproved", email };
      track.timer = setTimeout(
        () => put(endpoint, track, after),
        Math.min(Math.max(until * 1000 - Date.now(), 0), MAX_TIMER_MS),
      );
    }
    setStates((prev) => ({ ...prev, [endpoint]: state }));
  }

  function untrack(endpoint: string) {
    const track = tracks.current.get(endpoint);
    if (track?.timer != null) clearTimeout(track.timer);
    tracks.current.delete(endpoint);
  }

  /** Read the account and move its state along. */
  async function read(endpoint: string, track: Track): Promise<void> {
    const seq = ++track.readSeq;
    const current = () => isLive(endpoint, track) && track.readSeq === seq;
    track.reading = true;
    try {
      const account = await readAccountEmails(endpoint);
      if (!current()) return;
      track.account = account;
      const primary = primaryEmailOf(account);
      if (primary != null && isProvedEmail(primary)) {
        putProved(endpoint, track, primary.value);
        return;
      }
      const target = track.target != null ? emailEntry(account, track.target) : null;
      if (target != null && isProvedEmail(target)) {
        await makePrimary(endpoint, track, target.value);
        return;
      }
      // Nothing proved: a link still waited for stays so; any other step the
      // person took meanwhile is left as it is.
      if (track.state.kind !== "checking" && track.state.kind !== "proved") return;
      if (hasUsableEmail(account)) {
        put(endpoint, track, { kind: "unproved", email: account.email!.trim() });
      } else if (target != null) {
        put(endpoint, track, { kind: "waiting", email: target.value, viaAdd: true, canSendAgain: true });
      } else {
        const others = account.emails.filter((e) => e !== primary && hasUsableEmail({ email: e.value }));
        const known = others.find(isProvedEmail) ?? others[others.length - 1];
        put(endpoint, track, { kind: "missing", suggested: known?.value ?? null });
      }
    } catch (err: unknown) {
      if (!current()) return;
      console.warn(`${logLabel}: could not read the account's email:`, loggableError(err));
      // A missed poll is tried again at the next one.
      if (awaitsProof(track.state)) return;
      put(endpoint, track, {
        kind: "error",
        at: "read",
        viaAdd: track.target != null,
        message: emailRefusal(err, t("consent.verifyEmailReadFailed")).message,
      });
    } finally {
      if (track.readSeq === seq) track.reading = false;
    }
  }

  function putProved(endpoint: string, track: Track, email: string) {
    if (track.target != null) track.here = true;
    track.target = null;
    put(endpoint, track, { kind: "proved", email, here: track.here });
  }

  /** Make a verified address the primary one, then drop the invented one it replaces (best effort). */
  async function makePrimary(endpoint: string, track: Track, email: string): Promise<void> {
    const former = track.account?.email ?? null;
    track.target = email;
    try {
      const account = await setPrimaryEmail(endpoint, email);
      if (!isLive(endpoint, track)) return;
      track.account = account;
    } catch (err: unknown) {
      if (!isLive(endpoint, track)) return;
      console.warn(`${logLabel}: could not make the verified email the account's:`, loggableError(err));
      const message = emailRefusal(err, t("consent.emailAddFailed")).message;
      put(endpoint, track, { kind: "error", at: "read", viaAdd: true, message });
      return;
    }
    putProved(endpoint, track, email);
    if (former == null || !PLACEHOLDER_EMAIL.test(former.trim())) return;
    try {
      await removeAccountEmail(endpoint, former);
    } catch (err: unknown) {
      console.warn(`${logLabel}: could not remove the account's placeholder email:`, loggableError(err));
    }
  }

  async function add(endpoint: string, email: string): Promise<void> {
    const track = tracks.current.get(endpoint);
    if (track == null) return;
    const verifies = needsProof(endpoint);
    put(endpoint, track, { kind: "adding" });
    try {
      if (!verifies) {
        const stored = await setAccountEmail(endpoint, email);
        put(endpoint, track, { kind: "added", email: stored });
        return;
      }
      // An address the account holds already is not added twice.
      const known = track.account != null ? emailEntry(track.account, email) : null;
      if (known != null && isProvedEmail(known)) {
        await makePrimary(endpoint, track, known.value);
        return;
      }
      if (known != null) {
        await sendTo(endpoint, track, known.value, true);
        return;
      }
      const account = await addAccountEmail(endpoint, email);
      if (!isLive(endpoint, track) || track.state.kind === "proved") return;
      track.account = account;
      track.target = emailEntry(account, email)?.value ?? email;
      put(endpoint, track, { kind: "waiting", email: track.target, viaAdd: true, canSendAgain: false });
    } catch (err: unknown) {
      if (!isLive(endpoint, track)) return;
      console.warn(`${logLabel}: could not add the account's email:`, loggableError(err));
      const refusal = emailRefusal(err, t("consent.emailAddFailed"));
      put(
        endpoint,
        track,
        refusal.taken
          ? { kind: "taken", viaAdd: true }
          : { kind: "error", at: "add", viaAdd: true, message: refusal.message },
      );
    }
  }

  async function sendTo(endpoint: string, track: Track, email: string, viaAdd: boolean): Promise<void> {
    const sentBefore = track.target != null && track.target.toLowerCase() === email.toLowerCase();
    put(endpoint, track, { kind: "sending", email, viaAdd });
    track.target = email;
    try {
      const account = await resendVerificationEmail(endpoint, email);
      if (!isLive(endpoint, track) || track.state.kind === "proved") return;
      track.account = account;
      put(endpoint, track, { kind: "waiting", email, viaAdd, canSendAgain: false });
    } catch (err: unknown) {
      if (!isLive(endpoint, track) || track.state.kind === "proved") return;
      console.warn(`${logLabel}: could not send the verification email:`, loggableError(err));
      const refusal = emailRefusal(err, t("consent.verifyEmailSendFailed"));
      if (refusal.taken) {
        track.target = null;
        put(endpoint, track, { kind: "taken", viaAdd });
      } else if (refusal.retryAfterSeconds != null) {
        put(endpoint, track, {
          kind: "cooldown",
          email,
          viaAdd,
          until: Date.now() / 1000 + refusal.retryAfterSeconds,
          sent: sentBefore || !refusal.limited,
        });
      } else {
        put(endpoint, track, { kind: "error", at: "send", viaAdd, message: refusal.message });
      }
    }
  }

  async function send(endpoint: string): Promise<void> {
    const track = tracks.current.get(endpoint);
    const state = track?.state;
    if (track == null || state == null) return;
    if (state.kind === "unproved" || state.kind === "added") await sendTo(endpoint, track, state.email, false);
    else if (state.kind === "waiting") await sendTo(endpoint, track, state.email, state.viaAdd);
  }

  function change(endpoint: string) {
    const track = tracks.current.get(endpoint);
    if (track == null) return;
    track.target = null;
    put(endpoint, track, { kind: "missing", suggested: null });
  }

  async function recheck(endpoint: string | null): Promise<boolean> {
    const track = endpoint != null ? tracks.current.get(endpoint) : undefined;
    if (endpoint == null || track == null) return false;
    // A step of the person's own (a form, a link waited for) is left as it is.
    if (track.state.kind === "error") put(endpoint, track, CHECKING);
    await read(endpoint, track);
    return isLive(endpoint, track) && track.state.kind === "proved";
  }

  // Follow the accounts of this render, forget the others.
  const endpointsKey = [...new Set(requests.map((r) => r.endpoint))].sort().join(" ");
  useEffect(() => {
    const wanted = new Set(endpointsKey === "" ? [] : endpointsKey.split(" "));
    const gone = [...tracks.current.keys()].filter((e) => !wanted.has(e));
    gone.forEach(untrack);
    if (gone.length > 0) {
      setStates((prev) => Object.fromEntries(Object.entries(prev).filter(([e]) => !gone.includes(e))));
    }
    for (const endpoint of wanted) {
      if (tracks.current.has(endpoint)) continue;
      const track: Track = {
        state: CHECKING, account: null, target: null, here: false, readSeq: 0, reading: false, timer: null,
      };
      tracks.current.set(endpoint, track);
      put(endpoint, track, CHECKING);
      void read(endpoint, track);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpointsKey]);

  useEffect(() => {
    const followed = tracks.current;
    return () => {
      for (const endpoint of [...followed.keys()]) untrack(endpoint);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While a link is waited for: read every few seconds, only while visible.
  const waitingKey = Object.keys(states).filter((e) => awaitsProof(states[e])).sort().join(" ");
  useEffect(() => {
    if (waitingKey === "") return;
    const poll = () => {
      for (const endpoint of waitingKey.split(" ")) {
        const track = tracks.current.get(endpoint);
        if (track != null && !track.reading) void read(endpoint, track);
      }
    };
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer != null) clearInterval(timer);
      timer = null;
    };
    const follow = () => {
      stop();
      if (document.visibilityState === "hidden") return;
      timer = setInterval(poll, PROOF_POLL_MS);
    };
    const onVisibility = () => {
      follow();
      if (document.visibilityState !== "hidden") poll();
    };
    follow();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", poll);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingKey]);

  /** Whether an address added to this account has to be proved before it is the account's. */
  function needsProof(endpoint: string): boolean {
    return (
      requests.some((r) => r.endpoint === endpoint && r.required) ||
      (serviceInfo != null && registrationRequiresVerifiedEmail(serviceInfo))
    );
  }

  function stateOf(endpoint: string | null, required: boolean): VerifiedEmailState {
    const state = endpoint != null ? states[endpoint] ?? CHECKING : CHECKING;
    if (endpoint == null || state.kind === "proved") return state;
    if (serviceInfo == null) return CHECKING;
    const canMail = verificationOnAccount(serviceInfo);
    // Set here without a proof, before a consent requiring one was shown.
    const shown: VerifiedEmailState =
      required && state.kind === "added" ? { kind: "unproved", email: state.email } : state;
    if (required && !canMail && (shown.kind === "unproved" || shown.kind === "missing")) return { kind: "unavailable" };
    if (shown.kind === "missing") {
      if (!needsProof(endpoint)) return { kind: "missing", suggested: null };
      if (!canMail) return { kind: "unavailable" };
    }
    return shown;
  }

  return {
    stateOf,
    proved: (endpoint) => endpoint != null && states[endpoint]?.kind === "proved",
    adding: Object.values(states).some((s) => s.kind === "adding"),
    add,
    send,
    change,
    recheck,
  };
}
