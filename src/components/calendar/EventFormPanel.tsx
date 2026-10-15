"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import {
  Globe, ArrowsClockwise, Users,
  LinkSimple, MapPin, TextAlignLeft,
} from "@phosphor-icons/react";
import {
  eventFormTimeZone,
  getBrowserTimeZone,
  shiftInstantToTimeZoneFields,
  zoneLabel,
  zoneOffset,
  zonedDateTimeToUtc,
} from "@/lib/calendar-timezone";
import { EVENT_PRIORITIES, EVENT_TYPES, type CalendarEvent, type RepeatChoice } from "@/types/calendar-event";
import { nextHalfHour } from "@/lib/event-start";
import type { GoogleSeriesRepeat } from "@/lib/calendar-events";
import { nextRepeatDays } from "@/lib/recurrence";
import { getErrorMessage, isNetworkError } from "@/lib/error-utils";
import { addDays, toDateStr } from "@/lib/date-utils";
import { usePhone } from "@/lib/use-viewport-width";
import { descriptionForEditing } from "@/lib/rich-text";
import { DeleteAction, DialogButton, DialogCard, DialogFooter } from "@/components/form/Dialog";
import {
  ChoiceChips,
  ColorSwatches,
  FieldGroup,
  FieldRow,
  FieldStack,
  TextAreaField,
  TextField,
  ToggleRow,
} from "@/components/form/fields";
import SelectField from "@/components/form/SelectField";
import DateField, { formatFieldDate } from "@/components/form/DateField";
import TimeField from "@/components/form/TimeField";
import StatusBanner from "@/components/StatusBanner";

interface EventFormPanelProps {
  initialEvent?: Partial<CalendarEvent>;
  existingEvent?: CalendarEvent;
  onSave: (event: Omit<CalendarEvent, "id" | "created_at">) => Promise<void>;
  onDelete?: (eventId: string) => Promise<void>;
  onCancel: () => void;
  googleConnected?: boolean;
  /**
   * For a day of a Google series: its series' repeat, which Google sends
   * apart from the day, so it can still be on its way when the form opens.
   */
  seriesRepeat?: GoogleSeriesRepeat | "loading" | "failed";
}

/*
 * Google's eleven calendar colours, the only ones an event synced with Google
 * can carry, in the order of the spectrum: reds, orange, yellow, greens,
 * blues, purples, then grey, not Google's own order, which reads as random.
 */
const EVENT_COLORS = [
  { value: "#D50000", label: "Tomato" },
  { value: "#E67C73", label: "Flamingo" },
  { value: "#F4511E", label: "Tangerine" },
  { value: "#F6BF26", label: "Banana" },
  { value: "#33B679", label: "Sage" },
  { value: "#0B8043", label: "Basil" },
  { value: "#039BE5", label: "Peacock" },
  { value: "#3F51B5", label: "Blueberry" },
  { value: "#7986CB", label: "Lavender" },
  { value: "#8E24AA", label: "Grape" },
  { value: "#616161", label: "Graphite" },
] as const;
const DEFAULT_COLOR = "#33B679";

const TIMEZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver",
  "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu",
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Moscow",
  "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
];

const REPEAT_OPTIONS: { value: RepeatChoice; label: string }[] = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Every weekday, Mon to Fri" },
  { value: "weekly", label: "Every week" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Every month" },
  { value: "yearly", label: "Every year" },
];

/**
 * The repeat the form opens on. A day of a Google series takes its series'
 * (see the calendar page): the days arrive without their rule, so on their
 * own every one of them would read "Does not repeat".
 */
function openingRepeat(
  event: Partial<CalendarEvent> | undefined,
  seriesRepeat: GoogleSeriesRepeat | "loading" | "failed" | undefined,
): RepeatChoice {
  if (seriesRepeat && typeof seriesRepeat === "object") return seriesRepeat.repeat;
  if (event?.source === "google") return event.google?.repeat ?? "none";
  return event?.recurrence ?? "none";
}

function buildLocalDateTime(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr}:00`);
}

function toInputTimeStr(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function getWholeDaySpan(start: Date, end: Date): number {
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(0, Math.round((endDay.getTime() - startDay.getTime()) / 86400000));
}

export default function EventFormPanel({
  initialEvent,
  existingEvent,
  onSave,
  onDelete,
  onCancel,
  googleConnected,
  seriesRepeat,
}: EventFormPanelProps) {
  const phone = usePhone();
  /*
   * A Google event saves every field here, as Google's own (title, times,
   * colour) or, for what Google has no field for (priority, type, the
   * link), in the event's private properties. Only colour and repeats behave
   * differently: Google's eleven colours, and a rule read from its series.
   */
  const isGoogleEvent = existingEvent?.source === "google";
  const sourceStart = existingEvent?.start_time ?? initialEvent?.start_time;
  const sourceEnd = existingEvent?.end_time ?? initialEvent?.end_time;

  // Without memoising, the no-source case builds a fresh Date every render, so
  // these could not be listed as effect dependencies without looping.
  const defaultStart = useMemo(
    () => (sourceStart ? new Date(sourceStart) : nextHalfHour(new Date())),
    [sourceStart],
  );
  const defaultEnd = useMemo(
    () => (sourceEnd ? new Date(sourceEnd) : new Date(defaultStart.getTime() + 60 * 60 * 1000)),
    [sourceEnd, defaultStart],
  );
  const defaultTimeZone = eventFormTimeZone(existingEvent ?? initialEvent);
  const defaultFields = shiftInstantToTimeZoneFields(defaultStart, defaultEnd, defaultTimeZone);

  const [title, setTitle] = useState(existingEvent?.title ?? initialEvent?.title ?? "");
  const [allDay, setAllDay] = useState(existingEvent?.all_day ?? initialEvent?.all_day ?? false);
  const [startDateStr, setStartDateStr] = useState(defaultFields.startDateStr);
  const [endDateStr, setEndDateStr] = useState(defaultFields.endDateStr);
  const [startTime, setStartTime] = useState(defaultFields.startTimeStr);
  const [endTime, setEndTime] = useState(defaultFields.endTimeStr);
  const [timezone, setTimezone] = useState(defaultTimeZone);
  /*
   * The repeat chosen here, or null for the one the event opened with. Kept
   * apart so a series' repeat that arrives after the form opened shows up
   * without resetting anything typed meanwhile.
   */
  const [chosenRepeat, setChosenRepeat] = useState<RepeatChoice | null>(null);
  const seriesDay = isGoogleEvent && Boolean(existingEvent?.google?.seriesId);
  const repeatKnown = !seriesDay || Boolean(seriesRepeat && typeof seriesRepeat === "object");
  const repeat = chosenRepeat ?? openingRepeat(existingEvent ?? initialEvent, seriesRepeat);
  /*
   * A description from Google arrives as HTML; the field gets clean text.
   * Until it is typed in, the event keeps the description it came with: the
   * clean text saved back on every save would replace an invite's
   * description with one whose links had lost their addresses.
   */
  // Lazily: Google's HTML is parsed once, not again on every keystroke in the form.
  const [description, setDescription] = useState(() => descriptionForEditing(existingEvent?.description ?? initialEvent?.description));
  const [descriptionEdited, setDescriptionEdited] = useState(false);
  const [meetingNotes, setMeetingNotes] = useState(existingEvent?.meeting_notes ?? initialEvent?.meeting_notes ?? "");
  const [conferencing, setConferencing] = useState(existingEvent?.conferencing ?? initialEvent?.conferencing ?? "");
  const [location, setLocation] = useState(existingEvent?.location ?? initialEvent?.location ?? "");
  const [participants, setParticipants] = useState(existingEvent?.participants ?? initialEvent?.participants ?? "");
  const [color, setColor] = useState(existingEvent?.color ?? initialEvent?.color ?? DEFAULT_COLOR);
  const [importance, setImportance] = useState<'low' | 'medium' | 'high' | null>(existingEvent?.importance ?? initialEvent?.importance ?? null);
  const [eventType, setEventType] = useState<'work' | 'relaxation' | 'admin' | 'free' | 'personal' | null>(existingEvent?.event_type ?? initialEvent?.event_type ?? null);
  /*
   * Whether the event goes into Google Calendar. On by default for a new
   * one while Google is connected, since the whole schedule lives there: off,
   * an event added in CronCal would stay in CronCal and never reach Google,
   * with nothing on screen saying so.
   *
   * An event already in CronCal alone can be moved in with it, on purpose,
   * but not a repeating one: its skipped and changed days have no Google
   * form the move could carry. The choice is kept apart from the default so
   * the connection check finishing after the form opened still sets it.
   */
  const canGoToGoogle = !existingEvent || (existingEvent.source !== "google" && !existingEvent.recurrence);
  const [syncChoice, setSyncChoice] = useState<boolean | null>(null);
  const syncToGoogle = Boolean(googleConnected) && canGoToGoogle && (syncChoice ?? !existingEvent);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [endManuallyEdited, setEndManuallyEdited] = useState(false);
  const [formError, setFormError] = useState("");

  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);
  const [titleMissing, setTitleMissing] = useState(false);

  function syncEndFromNextStart(nextStartDateStr: string, nextStartTime: string) {
    if (allDay) {
      const previousStart = new Date(`${startDateStr}T00:00:00`);
      const previousEnd = new Date(`${endDateStr}T00:00:00`);
      const spanDays = getWholeDaySpan(previousStart, previousEnd);
      setEndDateStr(toDateStr(addDays(new Date(`${nextStartDateStr}T00:00:00`), spanDays)));
      return;
    }

    const previousStart = buildLocalDateTime(startDateStr, startTime);
    const previousEnd = buildLocalDateTime(endDateStr, endTime);
    const durationMs = Math.max(15 * 60 * 1000, previousEnd.getTime() - previousStart.getTime());
    const nextStart = buildLocalDateTime(nextStartDateStr, nextStartTime);
    const nextEnd = new Date(nextStart.getTime() + durationMs);
    setEndDateStr(toDateStr(nextEnd));
    setEndTime(toInputTimeStr(nextEnd));
  }

  // Sync form state when the backing event changes.
  useEffect(() => {
    setTitle(existingEvent?.title ?? initialEvent?.title ?? "");
    setAllDay(existingEvent?.all_day ?? initialEvent?.all_day ?? false);
    const nextTimeZone = eventFormTimeZone(existingEvent ?? initialEvent);
    const nextFields = shiftInstantToTimeZoneFields(defaultStart, defaultEnd, nextTimeZone);
    setStartDateStr(nextFields.startDateStr);
    setEndDateStr(nextFields.endDateStr);
    setStartTime(nextFields.startTimeStr);
    setEndTime(nextFields.endTimeStr);
    setTimezone(nextTimeZone);
    setChosenRepeat(null);
    setDescription(descriptionForEditing(existingEvent?.description ?? initialEvent?.description));
    setDescriptionEdited(false);
    setMeetingNotes(existingEvent?.meeting_notes ?? initialEvent?.meeting_notes ?? "");
    setConferencing(existingEvent?.conferencing ?? initialEvent?.conferencing ?? "");
    setLocation(existingEvent?.location ?? initialEvent?.location ?? "");
    setParticipants(existingEvent?.participants ?? initialEvent?.participants ?? "");
    setColor(existingEvent?.color ?? initialEvent?.color ?? DEFAULT_COLOR);
    setImportance(existingEvent?.importance ?? initialEvent?.importance ?? null);
    setEventType(existingEvent?.event_type ?? initialEvent?.event_type ?? null);
    setSyncChoice(null);
    setEndManuallyEdited(false);
    setConfirmingDelete(false);
    setDeleting(false);
    setFormError("");
  }, [
    existingEvent,
    initialEvent,
    defaultStart,
    defaultEnd,
  ]);

  /* CronCal's own repeat; a custom Google rule is none of the six. */
  const recurrence: CalendarEvent["recurrence"] = repeat === "none" || repeat === "custom" ? null : repeat;
  const previewDays = useMemo(
    () => (recurrence ? nextRepeatDays(recurrence, startDateStr, isGoogleEvent || syncToGoogle) : []),
    [recurrence, startDateStr, isGoogleEvent, syncToGoogle],
  );
  const repeatOptions = useMemo(() => {
    const options = REPEAT_OPTIONS.map((option) => ({ value: option.value, label: option.label }));
    if (openingRepeat(existingEvent, seriesRepeat) === "custom") {
      const label = seriesRepeat && typeof seriesRepeat === "object" ? seriesRepeat.label : existingEvent?.google?.repeatLabel;
      options.push({ value: "custom", label: label ?? "Custom, set in Google Calendar" });
    }
    return options;
  }, [existingEvent, seriesRepeat]);

  async function handleSave() {
    if (saving || deleting) return;
    if (!title.trim()) {
      setTitleMissing(true);
      titleRef.current?.focus();
      return;
    }
    setFormError("");

    const startDateTime = allDay
      ? zonedDateTimeToUtc(startDateStr, "00:00", timezone)
      : zonedDateTimeToUtc(startDateStr, startTime, timezone);
    const endDateTime = allDay
      ? zonedDateTimeToUtc(endDateStr, "23:59", timezone, 59)
      : zonedDateTimeToUtc(endDateStr, endTime, timezone);

    if (endDateTime.getTime() <= startDateTime.getTime()) {
      setFormError("End must be after the start.");
      return;
    }

    setSaving(true);
    try {
      const startIso = allDay
        ? zonedDateTimeToUtc(startDateStr, "00:00", timezone).toISOString()
        : zonedDateTimeToUtc(startDateStr, startTime, timezone).toISOString();
      const endIso = allDay
        ? zonedDateTimeToUtc(endDateStr, "23:59", timezone, 59).toISOString()
        : zonedDateTimeToUtc(endDateStr, endTime, timezone).toISOString();
      await onSave({
        title: title.trim(),
        description: descriptionEdited
          ? description.trim() || null
          : existingEvent?.description ?? initialEvent?.description ?? null,
        start_time: startIso,
        end_time: endIso,
        all_day: allDay,
        timezone,
        // A Google series' rule travels in `google.repeat`; Google events have no CronCal rule.
        recurrence: isGoogleEvent ? null : recurrence,
        // Not yet read from Google, it is not a choice, so it changes nothing.
        ...(isGoogleEvent && existingEvent?.google
          ? { google: { ...existingEvent.google, repeat: repeatKnown ? repeat : undefined } }
          : {}),
        participants: participants.trim() || null,
        conferencing: conferencing.trim() || null,
        meeting_notes: meetingNotes.trim() || null,
        location: location.trim() || null,
        color,
        importance,
        event_type: eventType,
        // On: the event goes to Google Calendar instead of staying in CronCal.
        sync_to_google: syncToGoogle,
      });
    } catch (error) {
      // Google says why it refused, and the reason is worth more than "Try again".
      const fallback = existingEvent ? "Could not save these changes. Try again." : "Could not create this event. Try again.";
      setFormError(isNetworkError(error) ? "Could not reach the server. Check the connection and try again." : getErrorMessage(error, fallback));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!existingEvent || !onDelete || deleting) return;
    setDeleting(true);
    setFormError("");
    try {
      await onDelete(existingEvent.id);
    } catch (error) {
      setFormError(getErrorMessage(error, "Could not delete this event. Try again."));
    } finally {
      setDeleting(false);
      // A repeating event asks which days next; cancelled, Delete is back to one press.
      setConfirmingDelete(false);
    }
  }

  /*
   * The zone list, with the event's own zone and this device's added when the
   * short list lacks them. A select given a value it has no option for
   * shows the first zone instead, so an event in Kuala Lumpur would read as
   * UTC.
   */
  const zoneOptions = useMemo(() => {
    const zones = [...TIMEZONES];
    for (const extra of [timezone, getBrowserTimeZone()]) {
      if (extra && !zones.includes(extra)) zones.push(extra);
    }
    return zones.map((zone) => ({ value: zone, label: zoneLabel(zone), hint: zoneOffset(zone) }));
  }, [timezone]);

  function changeTimezone(nextTimezone: string) {
    if (!allDay) {
      const currentStartInstant = zonedDateTimeToUtc(startDateStr, startTime, timezone);
      const currentEndInstant = zonedDateTimeToUtc(endDateStr, endTime, timezone);
      const shifted = shiftInstantToTimeZoneFields(currentStartInstant, currentEndInstant, nextTimezone);
      setStartDateStr(shifted.startDateStr);
      setStartTime(shifted.startTimeStr);
      setEndDateStr(shifted.endDateStr);
      setEndTime(shifted.endTimeStr);
    }
    setTimezone(nextTimezone);
    setFormError("");
  }

  const heading = existingEvent ? "Edit event" : "New event";

  const footer = (
    <DialogFooter
      start={existingEvent && onDelete ? (
        <DeleteAction
          armed={confirmingDelete}
          busy={deleting}
          disabled={saving}
          onPress={() => { if (confirmingDelete) void handleDelete(); else setConfirmingDelete(true); }}
          onKeep={() => setConfirmingDelete(false)}
        />
      ) : undefined}
    >
      <DialogButton variant="secondary" onClick={onCancel} disabled={saving || deleting}>
        Cancel
      </DialogButton>
      <DialogButton variant="primary" onClick={() => { void handleSave(); }} disabled={saving || deleting} busy={saving}>
        {saving ? "Saving…" : existingEvent ? "Save" : "Add event"}
      </DialogButton>
    </DialogFooter>
  );

  return (
    <DialogCard
      label={heading}
      heading={heading}
      onClose={onCancel}
      busy={saving || deleting}
      footer={footer}
      closeLabel="Close event"
    >
      <FieldStack>
        <FieldGroup label="Title" htmlFor="event-title">
          <TextField
            id="event-title"
            large
            inputRef={titleRef}
            placeholder="Event title"
            value={title}
            invalid={titleMissing}
            onChange={(e) => {
              setTitle(e.target.value);
              if (e.target.value.trim()) setTitleMissing(false);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              void handleSave();
            }}
          />
        </FieldGroup>

        <FieldGroup label="Description" htmlFor="event-description">
          <TextAreaField
            id="event-description"
            icon={<TextAlignLeft size={14} />}
            rows={4}
            placeholder="Add a description"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setDescriptionEdited(true);
            }}
          />
        </FieldGroup>

        <ToggleRow label="All day" checked={allDay} onChange={setAllDay} />

        <FieldRow phone={phone}>
          <FieldGroup label="Starts">
            <div style={{ display: "grid", gridTemplateColumns: allDay ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(96px, 0.8fr)", gap: 8 }}>
              <DateField
                ariaLabel="Start date"
                value={startDateStr}
                onChange={(next) => {
                  if (!next) return;
                  if (!endManuallyEdited) syncEndFromNextStart(next, startTime);
                  setStartDateStr(next);
                  setFormError("");
                }}
              />
              {!allDay && (
                <TimeField
                  ariaLabel="Start time"
                  value={startTime}
                  onChange={(next) => {
                    if (!next) return;
                    if (!endManuallyEdited) syncEndFromNextStart(startDateStr, next);
                    setStartTime(next);
                    setFormError("");
                  }}
                />
              )}
            </div>
          </FieldGroup>
          <FieldGroup label="Ends">
            <div style={{ display: "grid", gridTemplateColumns: allDay ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(96px, 0.8fr)", gap: 8 }}>
              <DateField
                ariaLabel="End date"
                value={endDateStr}
                invalid={Boolean(formError) && formError.startsWith("End")}
                onChange={(next) => {
                  if (!next) return;
                  setEndDateStr(next);
                  setEndManuallyEdited(true);
                  setFormError("");
                }}
              />
              {!allDay && (
                <TimeField
                  ariaLabel="End time"
                  value={endTime}
                  onChange={(next) => {
                    if (!next) return;
                    setEndTime(next);
                    setEndManuallyEdited(true);
                    setFormError("");
                  }}
                />
              )}
            </div>
          </FieldGroup>
        </FieldRow>

        <FieldRow phone={phone}>
          <FieldGroup label="Time zone">
            <SelectField
              ariaLabel="Time zone"
              icon={<Globe size={14} />}
              value={timezone}
              options={zoneOptions}
              onChange={changeTimezone}
            />
          </FieldGroup>
          <FieldGroup label="Repeats">
            <SelectField
              ariaLabel="Repeats"
              icon={<ArrowsClockwise size={14} />}
              value={repeatKnown ? repeat : null}
              options={repeatOptions}
              onChange={setChosenRepeat}
              disabled={!repeatKnown}
              placeholder={seriesRepeat === "failed" ? "Could not read it from Google" : "Reading it from Google…"}
            />
          </FieldGroup>
        </FieldRow>

        {repeatKnown && previewDays.length > 0 && (
          <p style={{ fontSize: "var(--ui-type-caption)", color: "var(--c-text-3)", lineHeight: 1.5, marginTop: -8 }}>
            Next: {previewDays.map(formatFieldDate).join(", ")}
          </p>
        )}

        <FieldRow phone={phone}>
          <FieldGroup label="Priority">
            <ChoiceChips
              ariaLabel="Priority"
              allowNone
              phone={phone}
              value={importance}
              onChange={setImportance}
              options={EVENT_PRIORITIES}
            />
          </FieldGroup>
          <FieldGroup label="Type">
            <ChoiceChips
              ariaLabel="Type"
              allowNone
              phone={phone}
              value={eventType}
              onChange={setEventType}
              options={EVENT_TYPES}
            />
          </FieldGroup>
        </FieldRow>

        <FieldRow phone={phone}>
          <FieldGroup label="Link" htmlFor="event-link">
            <TextField
              id="event-link"
              icon={<LinkSimple size={14} />}
              placeholder="Add a link"
              value={conferencing}
              onChange={(e) => setConferencing(e.target.value)}
            />
          </FieldGroup>
          <FieldGroup label="Location" htmlFor="event-location">
            <TextField
              id="event-location"
              icon={<MapPin size={14} />}
              placeholder="Add a location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </FieldGroup>
        </FieldRow>

        <FieldGroup label="Participants" htmlFor="event-participants">
          <TextField
            id="event-participants"
            icon={<Users size={14} />}
            placeholder="Add participants"
            value={participants}
            onChange={(e) => setParticipants(e.target.value)}
          />
        </FieldGroup>

        <FieldGroup label="Colour">
          <ColorSwatches ariaLabel="Event colour" options={EVENT_COLORS} value={color} onChange={setColor} />
        </FieldGroup>

        {googleConnected && canGoToGoogle && (
          <ToggleRow label="Sync to Google Calendar" checked={syncToGoogle} onChange={setSyncChoice} />
        )}

        {formError && <StatusBanner message={formError} onDismiss={() => setFormError("")} />}
      </FieldStack>
    </DialogCard>
  );
}
