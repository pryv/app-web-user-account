import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { Card, Button, Field, Alert, SelectField, SectionLabel } from "../../components/ui";
import { useConfirm } from "../../components/ConfirmDialog";
import { usePasswordPrompt } from "../../components/PasswordPrompt";
import { formatDate } from "../../lib/dates";
import { useSession } from "../../lib/useSession";
import i18n from "../../i18n";
import {
  AUTO_DELETION_ERRORS,
  AutoDeletionError,
  autoDeletionErrorKey,
  dayOf,
  earliestDay,
  endOfLocalDayIso,
  getAutoDeletion,
  inactivityPresets,
  paramsFor,
  readAutoDeletionFeature,
  remindersFor,
  requiresPassword,
  setAutoDeletion,
  toSeconds,
  type AutoDeletionChoice,
  type AutoDeletionChoiceMode,
  type AutoDeletionFeature,
  type AutoDeletionState,
} from "../../lib/autoDeletion";

/**
 * "Automatic deletion" card of the data-rights page.
 *
 * Shows the account's schedule as the platform computes it (date, period
 * without use, where it comes from, last use, next reminder, why reminders
 * cannot be sent) and lets the owner change it: follow the platform's policy,
 * never, a fixed date or a period without use. Every change is confirmed in
 * the app's own dialog, summarising what will happen and when reminders go
 * out; arming or shortening a schedule also asks the account password.
 *
 * Hidden when the platform does not offer the feature. A session acting for
 * a controlled account sees the schedule but not the controls: only the owner
 * may change it, signed in with their own password (the platform refuses a
 * delegate anyway).
 *
 * The action at the deadline is deletion. The platform's contract carries an
 * `action` so another one (handing the account over to someone) can be added
 * as its own section of this card later.
 */
export default function AutoDeletionCard({ exportAnchorId }: { exportAnchorId: string }) {
  const { t } = useTranslation();
  const { connection, actingAs } = useSession();
  const [confirm, confirmDialog] = useConfirm();
  const [askPassword, passwordDialog] = usePasswordPrompt();

  // undefined: not known yet; null: not offered by this platform.
  const [feature, setFeature] = useState<AutoDeletionFeature | null | undefined>(undefined);
  const [state, setState] = useState<AutoDeletionState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [serverDelegate, setServerDelegate] = useState(false);

  // Form
  const [mode, setMode] = useState<AutoDeletionChoiceMode>("default");
  const [day, setDay] = useState("");
  const [period, setPeriod] = useState("custom");
  const [customDays, setCustomDays] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [ackForced, setAckForced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const resetForm = useCallback((s: AutoDeletionState) => {
    const setting = s.setting;
    const m: AutoDeletionChoiceMode = setting?.mode ?? "default";
    setMode(m);
    setDay(setting?.mode === "date" ? dayOf(setting.date) : "");
    const days = setting?.mode === "inactivity" ? setting.inactivityDays : null;
    const preset = days != null && inactivityPresets(null).some((p) => p.days === days);
    setPeriod(days == null ? "custom" : preset ? String(days) : "custom");
    setCustomDays(days != null && !preset ? String(days) : "");
    setAcknowledged(false);
    setAckForced(false);
  }, []);

  const load = useCallback(async () => {
    if (!connection) return;
    try {
      const s = await getAutoDeletion(connection);
      setState(s);
      setLoadError(false);
      resetForm(s);
    } catch {
      setLoadError(true);
    }
  }, [connection, resetForm]);

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => connection.service.info())
      .then((info) => {
        if (cancelled) return;
        const f = readAutoDeletionFeature(info);
        setFeature(f);
        if (f == null) return;
        void load();
        // The server's word on whether this session acts for another account,
        // as the delegated-session banner reads it.
        Promise.resolve()
          .then(() => connection.accessInfo())
          .then((info) => {
            const d = (info as { delegation?: { isDelegatedAccess?: boolean } } | null)?.delegation;
            if (!cancelled) setServerDelegate(d?.isDelegatedAccess === true);
          })
          .catch(() => {});
      })
      .catch(() => {
        if (!cancelled) setFeature(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connection, load]);

  if (!connection || !feature) return null;
  const feat = feature;

  const delegate = actingAs != null || serverDelegate;
  const bounds = state?.bounds ?? feature.bounds;
  const actions = state?.actions ?? feature.actions;
  const deleteAllowed = actions.includes("delete");
  const userOverride = state?.userOverride ?? feature.userOverride;
  const allowUserOptOut = state?.allowUserOptOut ?? feature.allowUserOptOut;
  const presets = inactivityPresets(bounds);
  const minDay = earliestDay(new Date(), bounds?.minLeadDays ?? 0);

  const choice: AutoDeletionChoice =
    mode === "date"
      ? { mode, day }
      : mode === "inactivity"
        ? { mode, inactivityDays: period === "custom" ? Number(customDays) : Number(period) }
        : { mode };

  return (
    <Card>
      <div data-testid="auto-deletion-card">
        <SectionLabel>{t("data.autoDeletion.title")}</SectionLabel>
        {loadError && <Alert>{t("data.autoDeletion.loadFailed")}</Alert>}
        {state == null && !loadError && <p className="text-sm text-muted">{t("common.loading")}</p>}
        {state != null && (
          <>
            <Status state={state} />
            <p className="mb-3 text-sm text-muted">{t("data.autoDeletion.activityHelp")}</p>
            <p className="mb-4 text-sm">
              <a
                href={"#" + exportAnchorId}
                onClick={(e) => {
                  const target = document.getElementById(exportAnchorId);
                  if (!target) return;
                  e.preventDefault();
                  target.scrollIntoView?.({ behavior: "smooth", block: "start" });
                  target.querySelector<HTMLElement>("a, button")?.focus();
                }}
                className="inline-flex items-center gap-1 text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Download size={14} aria-hidden />
                {t("data.autoDeletion.exportFirst")}
              </a>
            </p>
            {delegate ? (
              <p className="text-sm text-muted" data-testid="auto-deletion-delegate-note">
                {t("data.autoDeletion.delegateNote")}
              </p>
            ) : (
              renderForm(state)
            )}
          </>
        )}
      </div>
      {confirmDialog}
      {passwordDialog}
    </Card>
  );

  function renderForm(s: AutoDeletionState): ReactNode {
    const presetKnown = s.effective.source === "operator";
    const options: Array<{ value: AutoDeletionChoiceMode; label: string; hint?: string; stale?: boolean }> = [];
    options.push({
      value: "default",
      label: t("data.autoDeletion.optionDefault"),
      hint:
        s.setting != null
          ? t("data.autoDeletion.optionDefaultClearHint")
          : presetKnown && s.effective.mode === "inactivity" && s.effective.inactivityDays != null
            ? t("data.autoDeletion.optionDefaultPresetHint", { days: s.effective.inactivityDays })
            : presetKnown
              ? undefined
              : t("data.autoDeletion.optionDefaultNoneHint"),
    });
    if (allowUserOptOut || s.setting?.mode === "never") {
      options.push({ value: "never", label: t("data.autoDeletion.optionNever"), hint: t("data.autoDeletion.optionNeverHint") });
    }
    const custom = deleteAllowed && userOverride;
    if (custom && feat.triggers.includes("date")) {
      options.push({ value: "date", label: t("data.autoDeletion.optionDate") });
    }
    if (custom && feat.triggers.includes("inactivity")) {
      options.push({ value: "inactivity", label: t("data.autoDeletion.optionInactivity") });
    }
    // The holder's own date or period that this platform no longer offers stays
    // shown (and selected), read-only: they can still move to another option.
    const stored = s.setting?.mode;
    if ((stored === "date" || stored === "inactivity") && !options.some((o) => o.value === stored)) {
      options.push({
        value: stored,
        label: t(stored === "date" ? "data.autoDeletion.optionDate" : "data.autoDeletion.optionInactivity"),
        hint: t("data.autoDeletion.optionNoLongerOffered"),
        stale: true,
      });
    }
    const readOnly = options.some((o) => o.value === mode && o.stale === true);

    const note = !deleteAllowed
      ? t("data.autoDeletion.deleteNotAllowed")
      : !userOverride
        ? t("data.autoDeletion.overrideNotAllowedNote")
        : null;
    if (options.length <= 1) {
      return note ? <p className="text-sm text-muted">{note}</p> : null;
    }

    const valid = isValid();
    const unchanged = isUnchanged(s);
    const ackRequired = (mode === "date" || mode === "inactivity") && (s.mail !== "available" || ackForced);

    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(s);
        }}
      >
        {note && <p className="mb-3 text-sm text-muted">{note}</p>}
        <fieldset className="mb-4">
          <legend className="mb-2 text-sm font-medium text-muted">{t("data.autoDeletion.choiceLegend")}</legend>
          <div className="flex flex-col gap-2">
            {options.map((o) => (
              <label key={o.value} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="auto-deletion-mode"
                  value={o.value}
                  checked={mode === o.value}
                  onChange={() => {
                    setMode(o.value);
                    // A period without use starts on the shortest offered preset.
                    if (o.value === "inactivity" && period === "custom" && customDays === "" && presets.length > 0) {
                      setPeriod(String(presets[0].days));
                    }
                    setError(null);
                    setNotice(null);
                  }}
                  disabled={busy}
                  className="mt-1 accent-primary"
                />
                <span>
                  {o.label}
                  {o.hint && <span className="block text-xs text-muted">{o.hint}</span>}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {mode === "date" && (
          <Field
            id="auto-deletion-date"
            type="date"
            label={t("data.autoDeletion.dateLabel")}
            hint={t("data.autoDeletion.dateHint", { date: formatDate(Date.parse(endOfLocalDayIso(minDay)) / 1000) })}
            min={minDay}
            value={day}
            onChange={(e) => setDay(e.target.value)}
            disabled={busy || readOnly}
            required
          />
        )}

        {mode === "inactivity" && (
          <>
            <SelectField
              id="auto-deletion-period"
              label={t("data.autoDeletion.periodLabel")}
              value={period}
              onChange={setPeriod}
              disabled={busy || readOnly}
              options={[
                ...presets.map((p) => ({
                  value: String(p.days),
                  label: t("data.autoDeletion.periodYears", { count: p.years, days: p.days }),
                })),
                { value: "custom", label: t("data.autoDeletion.periodCustom") },
              ]}
            />
            {period === "custom" && (
              <Field
                id="auto-deletion-days"
                type="number"
                inputMode="numeric"
                label={t("data.autoDeletion.daysLabel")}
                hint={bounds ? t("data.autoDeletion.daysHint", { min: bounds.minDays, max: bounds.maxDays }) : undefined}
                min={bounds?.minDays}
                max={bounds?.maxDays}
                step={1}
                value={customDays}
                onChange={(e) => setCustomDays(e.target.value)}
                disabled={busy || readOnly}
                required
              />
            )}
          </>
        )}

        {ackRequired && (
          <div className="mb-4 flex items-start gap-2">
            <input
              id="auto-deletion-ack"
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              disabled={busy}
              className="mt-1 h-4 w-4 shrink-0 accent-primary"
            />
            <label htmlFor="auto-deletion-ack" className="text-sm text-ink">
              {t("data.autoDeletion.ackNoReminders")}
            </label>
          </div>
        )}

        {error && <Alert>{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
        <Button
          type="submit"
          className="w-auto"
          disabled={busy || unchanged || !valid || (ackRequired && !acknowledged)}
        >
          {busy ? t("common.saving") : t("common.save")}
        </Button>
      </form>
    );
  }

  function isValid(): boolean {
    if (mode === "date") return day !== "" && day >= minDay;
    if (mode === "inactivity") {
      const n = choice.inactivityDays;
      if (n == null || !Number.isInteger(n) || n <= 0) return false;
      return bounds == null || (n >= bounds.minDays && n <= bounds.maxDays);
    }
    return true;
  }

  function isUnchanged(s: AutoDeletionState): boolean {
    const setting = s.setting;
    if (mode === "default") return setting == null;
    if (setting == null || setting.mode !== mode) return false;
    if (mode === "never") return true;
    if (mode === "inactivity") return setting.inactivityDays === choice.inactivityDays;
    return dayOf(setting.date) === day;
  }

  function summary(c: AutoDeletionChoice, withPassword: boolean): ReactNode {
    const lines: string[] = [];
    if (c.mode === "default") lines.push(t("data.autoDeletion.confirmDefault"));
    if (c.mode === "never") lines.push(t("data.autoDeletion.confirmNever"));
    if (c.mode === "date" && c.day) {
      lines.push(t("data.autoDeletion.confirmDate", { date: formatDate(Date.parse(endOfLocalDayIso(c.day)) / 1000) }));
    }
    if (c.mode === "inactivity") {
      lines.push(t("data.autoDeletion.confirmInactivity", { days: c.inactivityDays }));
    }
    if (c.mode === "date" || c.mode === "inactivity") {
      const leads = remindersFor(feat.reminderLeadDays, c, new Date());
      if (state?.mail !== "available") lines.push(t("data.autoDeletion.confirmNoReminders"));
      else if (leads.length > 0) lines.push(t("data.autoDeletion.confirmReminders", { list: listOf(leads) }));
    }
    if (state?.mail === "available") lines.push(t("data.autoDeletion.confirmEmail"));
    if (withPassword) lines.push(t("data.autoDeletion.confirmPassword"));
    return (
      <>
        {lines.map((line, i) => (
          <span key={i} className={i < lines.length - 1 ? "mb-2 block" : "block"}>
            {line}
          </span>
        ))}
      </>
    );
  }

  async function save(s: AutoDeletionState) {
    if (!connection) return;
    const c = choice;
    const arming = c.mode === "date" || c.mode === "inactivity";
    const params = paramsFor(c);
    if (arming && (s.mail !== "available" || ackForced) && acknowledged) params.acknowledgeNoReminders = true;
    const confirmLabel = t("data.autoDeletion.confirmButton");

    let password: string | undefined;
    if (requiresPassword(s.setting, c)) {
      const typed = await askPassword(summary(c, true), { confirmLabel, danger: arming });
      if (typed == null) return;
      password = typed;
    } else if (!(await confirm(summary(c, false), { confirmLabel, danger: arming }))) {
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      for (;;) {
        try {
          await setAutoDeletion(connection, password != null ? { ...params, password } : params);
          await load();
          setNotice(t("data.autoDeletion.saved"));
          return;
        } catch (err) {
          // The platform asks the password where this page did not expect it.
          if (password == null && err instanceof AutoDeletionError && err.has(AUTO_DELETION_ERRORS.passwordRequired)) {
            const typed = await askPassword(summary(c, true), { confirmLabel, danger: arming });
            if (typed == null) return;
            password = typed;
            continue;
          }
          if (err instanceof AutoDeletionError && err.has(AUTO_DELETION_ERRORS.noEmail)) setAckForced(true);
          setError(errorMessage(err));
          return;
        }
      }
    } finally {
      setBusy(false);
    }
  }

  function errorMessage(err: unknown): string {
    const key = autoDeletionErrorKey(err);
    if (key === "outOfBounds" && bounds) {
      return t("data.autoDeletion.errors.outOfBounds", { min: bounds.minDays, max: bounds.maxDays, lead: bounds.minLeadDays });
    }
    if (key) return t("data.autoDeletion.errors." + key);
    const message = err instanceof Error && err.message ? err.message : t("data.autoDeletion.errors.unknown");
    return t("data.autoDeletion.errors.generic", { message });
  }
}

/** Why a schedule is on hold, for the reasons (and deletion guards) the platform names. */
function blockedKey(blocked: { reason: string; guard?: string }): string {
  if (blocked.reason === "inactivity-unavailable") return "data.autoDeletion.blockedInactivityUnavailable";
  if (blocked.reason === "self-deletion-disabled") return "data.autoDeletion.blockedSelfDeletion";
  if (blocked.reason === "deletion-guard" && blocked.guard === "delegation") return "data.autoDeletion.blockedDelegation";
  return "data.autoDeletion.blocked";
}

/** The schedule in plain words. */
function Status({ state }: { state: AutoDeletionState }) {
  const { t } = useTranslation();
  const eff = state.effective;
  const at = state.deleteAt ?? state.deadline ?? null;
  const scheduled = eff.source !== "none" && eff.mode !== "never";
  const lines: string[] = [];

  if (!scheduled) {
    lines.push(t(state.setting?.mode === "never" ? "data.autoDeletion.statusNever" : "data.autoDeletion.statusNone"));
  } else if (eff.mode === "date") {
    lines.push(t("data.autoDeletion.statusDate", { date: formatDate(at ?? toSeconds(eff.date)) }));
  } else {
    lines.push(
      at != null
        ? t("data.autoDeletion.statusInactivity", { days: eff.inactivityDays, date: formatDate(at) })
        : t("data.autoDeletion.statusInactivityNoDate", { days: eff.inactivityDays }),
    );
  }
  if (scheduled) {
    lines.push(t(eff.source === "user" ? "data.autoDeletion.sourceUser" : "data.autoDeletion.sourceOperator"));
  }
  const last = state.lastActivity?.max;
  if (last != null) {
    lines.push(
      t(state.lastActivity?.by === "delegate" ? "data.autoDeletion.lastUsedByDelegate" : "data.autoDeletion.lastUsed", {
        date: formatDate(last),
      }),
    );
  }
  if (scheduled && state.nextReminderAt != null) {
    lines.push(t("data.autoDeletion.nextReminder", { date: formatDate(state.nextReminderAt) }));
  }
  if (scheduled && state.deadlineReason === "minimum-notice") lines.push(t("data.autoDeletion.minimumNotice"));

  const pausedNoEmail = state.blocked?.reason === "no-email";
  const warnings: string[] = [];
  if (pausedNoEmail) warnings.push(t("data.autoDeletion.pausedNoEmail"));
  else if (state.blocked != null) warnings.push(t(blockedKey(state.blocked), { reason: state.blocked.reason }));
  if (!pausedNoEmail && state.mail === "no-email") warnings.push(t("data.autoDeletion.mailNoEmail"));
  if (state.mail === "not-configured") warnings.push(t("data.autoDeletion.mailNotConfigured"));

  return (
    <div data-testid="auto-deletion-status">
      <ul className="mb-3 space-y-1 text-sm">
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {warnings.map((w, i) => (
        <Alert key={i} tone="info">
          {w}
        </Alert>
      ))}
    </div>
  );
}

/** "60, 30, 7 and 1" in the page's language. */
function listOf(numbers: number[]): string {
  const items = numbers.map(String);
  try {
    return new Intl.ListFormat(i18n.language || undefined, { style: "long", type: "conjunction" }).format(items);
  } catch {
    return items.join(", ");
  }
}
