import { useMemo } from "react";
import type { FormEvent } from "react";
import { errorText, fmtDate, shortTime, today } from "../../../shared/formatters";
import type { ScheduleView, Servant } from "../../../types";
import {
  deleteAvailabilityRecordById,
  deleteAvailabilityRuleById,
  deleteServingPreferenceById,
  insertAvailabilityRule,
  insertServingPreference,
  upsertAvailabilityDeadline,
  upsertAvailabilityRecord,
  upsertAvailabilityRecords,
} from "../services/availabilityPersistence";
import {
  validateRecurringAvailabilityRule,
  type AvailabilityRecord,
  type AvailabilityStatus,
  type RecurringAvailabilityRule,
} from "../services/recurringAvailability";
import type {
  AvailabilityRulePayload,
  AvailabilitySubmissionRow,
  ServingPreferencePayload,
} from "../services/availabilityPersistence";
import type { ServingPreferenceRecord } from "../services/availabilityData";

interface AvailabilityActionDependencies {
  client: typeof import("../../../supabase").supabase;
  isAdmin: boolean;
  servants: Servant[];
  sessionUserId?: string;
  availability: AvailabilityRecord[];
  availabilityRules: RecurringAvailabilityRule[];
  servingPreferences: ServingPreferenceRecord[];
  schedules: ScheduleView[];
  deadline: string;
  loadData: () => Promise<void>;
  setLoading: (value: boolean) => void;
  setMessage: (value: string) => void;
  setScheduleError: (value: string) => void;
  setAvailabilityDeadline: (value: string) => void;
}

/** Owns Availability mutation orchestration while App supplies shared data and refresh composition. */
export function useAvailabilityActions(dependencies: AvailabilityActionDependencies) {
  return useMemo(() => {
    const { client, isAdmin, servants, sessionUserId, availability, availabilityRules, servingPreferences, schedules, deadline, loadData, setLoading, setMessage, setScheduleError, setAvailabilityDeadline } = dependencies;

    async function saveAvailability(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (!client) return;
      const form = event.currentTarget;
      const formData = new FormData(form);
      const linkedServant = servants.find(servant => servant.auth_user_id === sessionUserId);
      const statusValue = String(formData.get("status"));
      if (statusValue !== "available" && statusValue !== "unavailable" && statusValue !== "prefer_not") {
        setMessage("Please select a valid availability status.");
        return;
      }
      const row: AvailabilitySubmissionRow = {
        servant_id: String(formData.get("servant_id")),
        service_date: String(formData.get("service_date")),
        status: statusValue as AvailabilityStatus,
        notes: String(formData.get("notes") || "").trim(),
      };
      if (!isAdmin && deadline && today() > deadline) {
        setMessage("The availability submission deadline (" + fmtDate(deadline) + ") has passed. Please contact the administrator if you need to change your availability.");
        return;
      }
      if (!isAdmin && (!linkedServant || row.servant_id !== linkedServant.id)) {
        setMessage("Your login is not linked to a servant profile. Please ask an administrator to link your account.");
        return;
      }
      const recurringConflict = availability.find(item => item.is_recurring && item.servant_id === row.servant_id && item.service_date === row.service_date && item.status !== row.status);
      if (recurringConflict) {
        setMessage("This date conflicts with a recurring " + recurringConflict.status.replace("_", " ") + " restriction. Review the recurring rule before saving.");
        return;
      }

      setLoading(true);
      setMessage("");
      try {
        const { error } = await upsertAvailabilityRecord(client, row);
        if (error) throw error;
        await loadData();
        form.reset();
        setMessage("Availability saved.");
      } catch (error) {
        setMessage(errorText(error));
      } finally {
        setLoading(false);
      }
    }

    async function saveBulkAvailability(rows: AvailabilitySubmissionRow[]): Promise<boolean> {
      if (!client) return false;
      const conflicts = rows.filter(row => availability.some(item => item.servant_id === row.servant_id && item.service_date === row.service_date && item.status !== row.status));
      if (conflicts.length) {
        setMessage("Cannot save: " + conflicts.length + " date/person combination(s) already have a different availability status. Resolve the conflicts first.");
        return false;
      }
      setLoading(true);
      setMessage("");
      try {
        const { error } = await upsertAvailabilityRecords(client, rows);
        if (error) throw error;
        await loadData();
        setMessage(rows.length + " availability record(s) saved.");
        return true;
      } catch (error) {
        setMessage(errorText(error));
        return false;
      } finally {
        setLoading(false);
      }
    }

    async function saveAvailabilityRule(rule: AvailabilityRulePayload): Promise<boolean> {
      if (!client) return false;
      const validation = validateRecurringAvailabilityRule(rule, availabilityRules, availability);
      if (!validation.ok) {
        if (validation.reason === "overlapping_rule") {
          setMessage("This recurring rule overlaps an existing rule with a different status. Review or remove the existing rule first.");
          return false;
        }
        setMessage("This rule conflicts with an existing availability entry on " + validation.conflictDate + ". Resolve that date before saving the recurring rule.");
        return false;
      }
      const { error } = await insertAvailabilityRule(client, rule, sessionUserId);
      if (error) {
        setMessage(errorText(error));
        return false;
      }
      await loadData();
      setMessage("Recurring availability restriction saved.");
      return true;
    }

    async function deleteAvailabilityRule(id: string) {
      if (!client) return;
      const { error } = await deleteAvailabilityRuleById(client, id);
      if (error) setMessage(errorText(error));
      else await loadData();
    }

    async function saveServingPreference(preference: ServingPreferencePayload): Promise<boolean> {
      if (!client) return false;
      const currentForPerson = servingPreferences.filter(rule => rule.servant_id === preference.servant_id && rule.active !== false);
      const combined = [...currentForPerson, preference];
      const conflicts = schedules
        .filter(schedule => schedule.service_date >= today() && schedule.assignments.some(assignment => assignment.servant_id === preference.servant_id))
        .filter(schedule => {
          const dateDow = new Date(schedule.service_date + "T12:00:00").getDay();
          const timeRules = combined.filter(rule => rule.rule_type === "allowed_time_window");
          const serviceRules = combined.filter(rule => rule.rule_type === "allowed_service_scope");
          const timeAllowed = !timeRules.length || timeRules.some(rule =>
            (!rule.days_of_week?.length || rule.days_of_week.includes(dateDow)) &&
            shortTime(schedule.start_time) >= String(rule.start_time).slice(0, 5) &&
            shortTime(schedule.end_time) <= String(rule.end_time).slice(0, 5),
          );
          const serviceAllowed = !serviceRules.length || serviceRules.some(rule =>
            rule.location_id === schedule.location_id && (!rule.service_names?.length || rule.service_names.includes(schedule.service_name)),
          );
          return !timeAllowed || !serviceAllowed;
        });
      if (conflicts.length) {
        const summaries = conflicts.slice(0, 4).map(schedule => schedule.service_name + " · " + fmtDate(schedule.service_date)).join("; ");
        setMessage("This restriction would conflict with " + conflicts.length + " existing upcoming assignment(s): " + summaries + ". Review or change those assignments before saving the restriction.");
        return false;
      }
      const { error } = await insertServingPreference(client, preference, sessionUserId);
      if (error) {
        setMessage(errorText(error));
        return false;
      }
      await loadData();
      setMessage("Serving eligibility rule saved and will be checked during manual assignment.");
      return true;
    }

    async function deleteServingPreference(id: string) {
      if (!client) return;
      const { error } = await deleteServingPreferenceById(client, id);
      if (error) setMessage(errorText(error));
      else {
        await loadData();
        setMessage("Serving eligibility rule removed.");
      }
    }

    async function deleteAvailability(id: string) {
      if (!client || !isAdmin) return;
      const { error } = await deleteAvailabilityRecordById(client, id);
      if (error) setMessage(errorText(error));
      else await loadData();
    }

    async function saveDeadline(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (!client || !isAdmin || !sessionUserId) return;
      setScheduleError("");
      const formData = new FormData(event.currentTarget);
      const value = String(formData.get("deadline") || "");
      const { error } = await upsertAvailabilityDeadline(client, value, sessionUserId);
      if (error) setMessage(errorText(error));
      else {
        setAvailabilityDeadline(value);
        setMessage("Availability deadline updated.");
      }
    }

    return { saveAvailability, saveBulkAvailability, saveAvailabilityRule, deleteAvailabilityRule, saveServingPreference, deleteServingPreference, deleteAvailability, saveDeadline };
  }, [
    dependencies.client, dependencies.isAdmin, dependencies.servants, dependencies.sessionUserId,
    dependencies.availability, dependencies.availabilityRules, dependencies.servingPreferences, dependencies.schedules, dependencies.deadline,
    dependencies.loadData, dependencies.setLoading, dependencies.setMessage, dependencies.setScheduleError, dependencies.setAvailabilityDeadline,
  ]);
}
