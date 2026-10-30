import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
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
  localDay,
  operatorNameOf,
  paramsFor,
  readAutoDeletionFeature,
  remindersFor,
  requiresPassword,
  sameEmail,
  setAutoDeletion,
  toSeconds,
  transferChanged,
  type AutoDeletionChoice,
  type AutoDeletionChoiceMode,
  type AutoDeletionFeature,
  type AutoDeletionState,
  type TransferChoice,
  type TransferFallback,
  type TransferNotify,
  type TransferRecord,
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
 * The action at the deadline is deletion, or, when the platform offers it, a
 * transfer: the account's management is offered to a beneficiary named by
 * email, who claims it from their own account within the platform's claim
 * window; if nobody does, the owner's fallback (delete or keep) applies. The
 * transfer section shows only for a date or a period, and only when the
 * platform lists `transfer` in its actions; with `delete` absent, the
 * transfer is the only action and the fallback can only be keep. The
 * beneficiary's optional name and date of birth are never shown back: the
 * card only says that they are stored, and offers to remove them. Setting or
 * changing a transfer, and turning it into a deletion, asks the password.
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
  const [operatorName, setOperatorName] = useState<string | null>(null);

  // Form
  const [mode, setMode] = useState<AutoDeletionChoiceMode>("default");
  const [day, setDay] = useState("");
  const [period, setPeriod] = useState("custom");
  const [customDays, setCustomDays] = useState("");
  const [action, setAction] = useState<"delete" | "transfer">("delete");
  const [beneficiaryEmail, setBeneficiaryEmail] = useState("");
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [beneficiaryBirth, setBeneficiaryBirth] = useState("");
  const [removeIdentity, setRemoveIdentity] = useState(false);
  const [notify, setNotify] = useState<TransferNotify>("atSetup");
  const [fallback, setFallback] = useState<TransferFallback>("delete");
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
    const transfer = setting?.action === "transfer" ? setting.transfer ?? null : null;
    setAction(setting?.action === "transfer" ? "transfer" : "delete");
    setBeneficiaryEmail(transfer?.email ?? "");
    setBeneficiaryName("");
    setBeneficiaryBirth("");
    setRemoveIdentity(false);
    setNotify(transfer?.notifyBeneficiary ?? "atSetup");
    // Without deletion offered, keeping the account is the only fallback.
    setFallback(transfer?.fallback ?? ((s.actions ?? []).includes("delete") ? "delete" : "keep"));
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
        setOperatorName(operatorNameOf(info));
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
  // The holder's own transfer stays shown even if the platform stopped offering it.
  const transferShown = actions.includes("transfer") || state?.setting?.action === "transfer";
  const userOverride = state?.userOverride ?? feature.userOverride;
  const allowUserOptOut = state?.allowUserOptOut ?? feature.allowUserOptOut;
  const presets = inactivityPresets(bounds);
  const minDay = earliestDay(new Date(), bounds?.minLeadDays ?? 0);
  const scheduling = mode === "date" || mode === "inactivity";
  // Transfer when chosen, or when it is the only action offered.
  const chosenAction: "delete" | "transfer" =
    scheduling && transferShown && (action === "transfer" || !deleteAllowed) ? "transfer" : "delete";
  const storedTransfer = state?.setting?.action === "transfer" ? state.setting.transfer ?? null : null;
  const sameBeneficiary = storedTransfer != null && sameEmail(storedTransfer.email, beneficiaryEmail);
  const identityStored = sameBeneficiary && storedTransfer?.identityGiven === true;

  const transferChoice: TransferChoice = {
    email: beneficiaryEmail,
    notifyBeneficiary: notify,
    fallback: deleteAllowed ? fallback : "keep",
  };
  if (removeIdentity && identityStored) {
    transferChoice.name = "";
    transferChoice.dateOfBirth = "";
  } else {
    // Empty fields keep what is stored; either one given replaces both.
    if (beneficiaryName.trim() !== "") transferChoice.name = beneficiaryName;
    if (beneficiaryBirth !== "") transferChoice.dateOfBirth = beneficiaryBirth;
  }
  const withAction = (c: AutoDeletionChoice): AutoDeletionChoice =>
    chosenAction === "transfer" ? { ...c, action: "transfer", transfer: transferChoice } : c;

  const choice: AutoDeletionChoice =
    mode === "date"
      ? withAction({ mode, day })
      : mode === "inactivity"
        ? withAction({ mode, inactivityDays: period === "custom" ? Number(customDays) : Number(period) })
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
    const custom = (deleteAllowed || transferShown) && userOverride;
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

    const note = !deleteAllowed && !transferShown
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

        {scheduling && transferShown && renderTransfer(readOnly)}

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

  function radio<V extends string>(
    name: string,
    value: V,
    current: V,
    onPick: (v: V) => void,
    label: string,
    disabled: boolean,
  ): ReactNode {
    return (
      <label key={value} className="flex items-start gap-2 text-sm">
        <input
          type="radio"
          name={name}
          value={value}
          checked={current === value}
          onChange={() => {
            onPick(value);
            setError(null);
            setNotice(null);
          }}
          disabled={disabled}
          className="mt-1 accent-primary"
        />
        <span>{label}</span>
      </label>
    );
  }

  /** "At that time": delete or transfer, and the transfer's beneficiary, notice and fallback. */
  function renderTransfer(readOnly: boolean): ReactNode {
    const off = busy || readOnly;
    const operator = operatorName ?? t("data.autoDeletion.transfer.operatorUnnamed");
    return (
      <div className="mb-4" data-testid="auto-deletion-transfer">
        {deleteAllowed ? (
          <fieldset className="mb-4">
            <legend className="mb-2 text-sm font-medium text-muted">{t("data.autoDeletion.transfer.actionLegend")}</legend>
            <div className="flex flex-col gap-2">
              {radio("auto-deletion-action", "delete", chosenAction, setAction, t("data.autoDeletion.transfer.actionDelete"), off)}
              {radio("auto-deletion-action", "transfer", chosenAction, setAction, t("data.autoDeletion.transfer.actionTransfer"), off)}
            </div>
          </fieldset>
        ) : (
          <p className="mb-4 text-sm text-muted">{t("data.autoDeletion.transfer.onlyTransfer")}</p>
        )}
        {chosenAction === "transfer" && (
          <>
            <Field
              id="auto-deletion-beneficiary-email"
              type="email"
              autoComplete="off"
              label={t("data.autoDeletion.transfer.emailLabel")}
              hint={t("data.autoDeletion.transfer.emailHint")}
              value={beneficiaryEmail}
              onChange={(e) => setBeneficiaryEmail(e.target.value)}
              disabled={off}
              required
            />
            {storedTransfer?.identityGiven === true && !sameBeneficiary && beneficiaryEmail.trim() !== "" && (
              <p className="mb-4 text-xs text-muted">{t("data.autoDeletion.transfer.identityDroppedOnChange")}</p>
            )}
            {identityStored && (
              <div className="mb-4 text-sm" data-testid="auto-deletion-identity-stored">
                <p className="mb-2">{t("data.autoDeletion.transfer.identityStored")}</p>
                <div className="flex items-start gap-2">
                  <input
                    id="auto-deletion-identity-remove"
                    type="checkbox"
                    checked={removeIdentity}
                    onChange={(e) => setRemoveIdentity(e.target.checked)}
                    disabled={off}
                    className="mt-1 h-4 w-4 shrink-0 accent-primary"
                  />
                  <label htmlFor="auto-deletion-identity-remove" className="text-sm text-ink">
                    {t("data.autoDeletion.transfer.identityRemove")}
                  </label>
                </div>
              </div>
            )}
            <Field
              id="auto-deletion-beneficiary-name"
              autoComplete="off"
              label={t("data.autoDeletion.transfer.nameLabel")}
              value={beneficiaryName}
              onChange={(e) => setBeneficiaryName(e.target.value)}
              disabled={off || (identityStored && removeIdentity)}
            />
            <Field
              id="auto-deletion-beneficiary-birth"
              type="date"
              label={t("data.autoDeletion.transfer.birthLabel")}
              max={localDay(new Date())}
              value={beneficiaryBirth}
              onChange={(e) => setBeneficiaryBirth(e.target.value)}
              disabled={off || (identityStored && removeIdentity)}
            />
            <p className="mb-4 text-xs text-muted" data-testid="auto-deletion-identity-notice">
              {t("data.autoDeletion.transfer.identityNotice", { operator })}
            </p>
            <fieldset className="mb-4">
              <legend className="mb-2 text-sm font-medium text-muted">{t("data.autoDeletion.transfer.notifyLegend")}</legend>
              <div className="flex flex-col gap-2">
                {radio("auto-deletion-notify", "atSetup", notify, setNotify, t("data.autoDeletion.transfer.notifyAtSetup"), off)}
                {radio("auto-deletion-notify", "atTrigger", notify, setNotify, t("data.autoDeletion.transfer.notifyAtTrigger"), off)}
              </div>
            </fieldset>
            <fieldset className="mb-2">
              <legend className="mb-2 text-sm font-medium text-muted">{t("data.autoDeletion.transfer.fallbackLegend")}</legend>
              <div className="flex flex-col gap-2">
                {deleteAllowed &&
                  radio("auto-deletion-fallback", "delete", fallback, setFallback, t("data.autoDeletion.transfer.fallbackDelete"), off)}
                {radio(
                  "auto-deletion-fallback",
                  "keep",
                  deleteAllowed ? fallback : "keep",
                  setFallback,
                  t("data.autoDeletion.transfer.fallbackKeep"),
                  off,
                )}
              </div>
            </fieldset>
          </>
        )}
      </div>
    );
  }

  function isValid(): boolean {
    if (chosenAction === "transfer" && !/^[^\s@]+@[^\s@]+$/.test(beneficiaryEmail.trim())) return false;
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
    if ((setting.action ?? "delete") !== (choice.action ?? "delete")) return false;
    if (choice.transfer != null && transferChanged(setting.transfer, choice.transfer)) return false;
    if (mode === "inactivity") return setting.inactivityDays === choice.inactivityDays;
    return dayOf(setting.date) === day;
  }

  function summary(c: AutoDeletionChoice, withPassword: boolean): ReactNode {
    const lines: string[] = [];
    if (c.mode === "default") lines.push(t("data.autoDeletion.confirmDefault"));
    if (c.mode === "never") lines.push(t("data.autoDeletion.confirmNever"));
    const tr = c.action === "transfer" ? c.transfer : undefined;
    if (c.mode === "date" && c.day) {
      const date = formatDate(Date.parse(endOfLocalDayIso(c.day)) / 1000);
      lines.push(
        tr
          ? t("data.autoDeletion.transfer.confirmDate", { date, email: tr.email.trim() })
          : t("data.autoDeletion.confirmDate", { date }),
      );
    }
    if (c.mode === "inactivity") {
      lines.push(
        tr
          ? t("data.autoDeletion.transfer.confirmInactivity", { days: c.inactivityDays, email: tr.email.trim() })
          : t("data.autoDeletion.confirmInactivity", { days: c.inactivityDays }),
      );
    }
    if (tr) {
      const windowDays = state?.claimWindowDays;
      lines.push(
        windowDays != null
          ? t("data.autoDeletion.transfer.confirmWindow", { count: windowDays })
          : t("data.autoDeletion.transfer.confirmWindowNoDays"),
      );
      const stored = state?.setting?.action === "transfer" ? state.setting.transfer : null;
      // Said only when the beneficiary or the notice changes: otherwise nothing new is sent.
      if (stored == null || !sameEmail(stored.email, tr.email) || stored.notifyBeneficiary !== tr.notifyBeneficiary) {
        lines.push(
          t(
            tr.notifyBeneficiary === "atSetup"
              ? "data.autoDeletion.transfer.confirmNotifyAtSetup"
              : "data.autoDeletion.transfer.confirmNotifyAtTrigger",
          ),
        );
      }
      lines.push(
        t(
          tr.fallback === "delete"
            ? "data.autoDeletion.transfer.confirmFallbackDelete"
            : "data.autoDeletion.transfer.confirmFallbackKeep",
        ),
      );
      if (tr.name === "" && tr.dateOfBirth === "") lines.push(t("data.autoDeletion.transfer.confirmIdentityRemoved"));
      lines.push(t("data.autoDeletion.transfer.confirmNotIncluded"));
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

  // A transfer names its beneficiary; the platform keeps it on the holder's own setting.
  const transfer = eff.action === "transfer" ? state.setting?.transfer ?? null : null;
  const email = transfer?.email ?? state.transfer?.email ?? "";
  const tr = eff.action === "transfer" ? "data.autoDeletion.transfer." : "data.autoDeletion.";

  if (!scheduled) {
    lines.push(t(state.setting?.mode === "never" ? "data.autoDeletion.statusNever" : "data.autoDeletion.statusNone"));
  } else if (eff.mode === "date") {
    lines.push(t(tr + "statusDate", { date: formatDate(at ?? toSeconds(eff.date)), email }));
  } else {
    lines.push(
      at != null
        ? t(tr + "statusInactivity", { days: eff.inactivityDays, date: formatDate(at), email })
        : t(tr + "statusInactivityNoDate", { days: eff.inactivityDays, email }),
    );
  }
  if (scheduled && transfer != null) {
    const windowDays = state.claimWindowDays;
    const key = transfer.fallback === "keep" ? "statusFallbackKeep" : "statusFallbackDelete";
    lines.push(
      windowDays != null
        ? t("data.autoDeletion.transfer." + key, { count: windowDays })
        : t("data.autoDeletion.transfer." + key + "NoDays"),
    );
  }
  if (scheduled) {
    lines.push(t(eff.source === "user" ? "data.autoDeletion.sourceUser" : "data.autoDeletion.sourceOperator"));
  }
  if (state.transfer != null) lines.push(...transferLines(state.transfer, t));
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
  const failed = state.transfer?.failedClaims;
  if (failed != null && failed.count > 0 && (state.transfer?.status === "open" || state.transfer?.status === "claimed")) {
    warnings.push(t("data.autoDeletion.transfer.recordFailedClaims", { count: failed.count, date: formatDate(failed.lastAt ?? null) }));
  }
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

/** The current or last transfer in plain words: who was told, the claim window, who claimed, how it ended. */
function transferLines(record: TransferRecord, t: TFunction): string[] {
  const k = "data.autoDeletion.transfer.";
  const lines: string[] = [];
  const email = record.email;
  if (record.beneficiaryNotifiedAt != null) {
    lines.push(t(k + "recordNotified", { email, date: formatDate(record.beneficiaryNotifiedAt) }));
  } else if (record.status === "named") {
    lines.push(t(k + "recordNotNotified", { email }));
  }
  switch (record.status) {
    case "open":
      lines.push(
        record.endsAt != null
          ? t(k + "recordOpen", { email, date: formatDate(record.endsAt) })
          : t(k + "recordOpenNoDate", { email }),
      );
      break;
    case "claimed":
      lines.push(t(k + "recordClaimed", { username: record.claimedBy?.username ?? email }));
      break;
    case "completed":
      lines.push(t(k + "recordCompleted", { username: record.claimedBy?.username ?? email }));
      break;
    case "declined":
      lines.push(t(k + "recordDeclined", { email }));
      break;
    case "cancelled": {
      const reason = record.closedReason;
      const known = reason === "owner-activity" || reason === "delegate-activity" || reason === "owner-change";
      lines.push(t(k + (known ? "recordCancelled_" + reason.replace("-", "_") : "recordCancelled")));
      break;
    }
    case "lapsed":
      lines.push(t(k + "recordLapsed", { email }));
      break;
    case "fallback-delete":
      lines.push(t(k + "recordFallbackDelete", { email }));
      break;
  }
  return lines;
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
