"use client";

import { useState } from "react";
import {
  Clock,
  CalendarBlank,
  ArrowsClockwise,
  Globe,
  Users,
  VideoCamera,
  FileText,
  MapPin,
  PencilSimple,
  Flag,
  Tag,
} from "@phosphor-icons/react";
import { EVENT_PRIORITIES, EVENT_TYPES, type CalendarEvent } from "@/types/calendar-event";
import { describeRecurrence } from "@/lib/recurrence";
import { getErrorMessage } from "@/lib/error-utils";
import { useTimeFormat, formatTime } from "@/lib/time-format";
import { zoneLabel, zoneOffset } from "@/lib/calendar-timezone";
import StatusBanner from "@/components/StatusBanner";
import GoogleBrandIcon from "@/components/GoogleBrandIcon";
import { DAYS_SHORT, MONTHS_SHORT, isSameDay } from "@/lib/date-utils";
import { DeleteAction, DialogButton, DialogCard, DialogFooter } from "@/components/form/Dialog";
import { DetailRow, FieldLabel, RichText, ViewTitle } from "@/components/form/fields";

interface EventDetailPanelProps {
  event: CalendarEvent;
  occurrence?: { start: Date; end: Date };
  onClose: () => void;
  onEdit: (event: CalendarEvent) => void;
  onDelete: (eventId: string) => void | Promise<void>;
}

function formatDuration(start: Date, end: Date): string {
  const diffMs = end.getTime() - start.getTime();
  const totalMin = Math.round(diffMs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** "Thu 16 Oct 2026". */
function formatDateLine(date: Date): string {
  return `${DAYS_SHORT[date.getDay()]} ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

/** "New York (GMT-4)", the offset as it is on the day. */
function formatZone(timeZone: string, at: Date): string {
  const offset = timeZone === "UTC" ? "" : zoneOffset(timeZone, at);
  return offset ? `${zoneLabel(timeZone)} (${offset})` : zoneLabel(timeZone);
}

export default function EventDetailPanel({
  event,
  occurrence,
  onClose,
  onEdit,
  onDelete,
}: EventDetailPanelProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const fmt = useTimeFormat();
  const start = occurrence ? occurrence.start : new Date(event.start_time);
  const end = occurrence ? occurrence.end : new Date(event.end_time);

  const timeStr = event.all_day
    ? "All day"
    : `${formatTime(start, fmt)} to ${formatTime(end, fmt)} · ${formatDuration(start, end)}`;
  const dateStr = isSameDay(start, end)
    ? formatDateLine(start)
    : `${formatDateLine(start)} to ${formatDateLine(end)}`;
  const priority = EVENT_PRIORITIES.find((choice) => choice.value === event.importance);
  const type = EVENT_TYPES.find((choice) => choice.value === event.event_type);
  // A day of a Google series arrives without its rule: it says it repeats, and Edit reads how.
  const recurrenceDesc = event.recurrence
    ? describeRecurrence(event.recurrence, new Date(event.start_time))
    : event.google?.repeatLabel ?? (event.google?.seriesId ? "Repeats" : null);

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await onDelete(event.id);
    } catch (error) {
      setDeleteError(getErrorMessage(error, "Could not delete this event. Try again."));
    } finally {
      setDeleting(false);
    }
  }

  const footer = (
    <DialogFooter
      start={(
        <DeleteAction
          armed={confirmingDelete}
          busy={deleting}
          onPress={() => { if (confirmingDelete) void handleDelete(); else setConfirmingDelete(true); }}
          onKeep={() => setConfirmingDelete(false)}
        />
      )}
    >
      <DialogButton variant="secondary" onClick={onClose} disabled={deleting}>
        Close
      </DialogButton>
      <DialogButton variant="primary" onClick={() => onEdit(event)} disabled={deleting}>
        <PencilSimple size={13} aria-hidden="true" />
        Edit
      </DialogButton>
    </DialogFooter>
  );

  const hasDetails = Boolean(event.participants || event.conferencing || event.meeting_notes || event.location);

  return (
    <DialogCard label="Event details" heading="Event" onClose={onClose} busy={deleting} footer={footer} closeLabel="Close event details">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <ViewTitle color={event.color}>{event.title}</ViewTitle>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <DetailRow icon={<Clock size={14} />}>{timeStr}</DetailRow>
          <DetailRow icon={<CalendarBlank size={14} />}>{dateStr}</DetailRow>
          {recurrenceDesc && <DetailRow icon={<ArrowsClockwise size={14} />}>{recurrenceDesc}</DetailRow>}
          {event.timezone && <DetailRow icon={<Globe size={14} />}>{formatZone(event.timezone, start)}</DetailRow>}
          {priority && (
            <DetailRow icon={<Flag size={14} />}>
              <span className="ui-hue-ink" style={{ ["--hue" as string]: priority.color, fontWeight: 500 }}>{priority.label} priority</span>
            </DetailRow>
          )}
          {type && (
            <DetailRow icon={<Tag size={14} />}>
              <span className="ui-hue-ink" style={{ ["--hue" as string]: type.color, fontWeight: 500 }}>{type.label}</span>
            </DetailRow>
          )}
          {event.source === "google" && <DetailRow icon={<GoogleBrandIcon size={14} />}>From Google Calendar</DetailRow>}
        </div>

        {hasDetails && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 16, borderTop: "1px solid var(--c-border-sub)" }}>
            {event.participants && <DetailRow icon={<Users size={14} />}>{event.participants}</DetailRow>}
            {event.conferencing && (
              <DetailRow icon={<VideoCamera size={14} />}>
                {/^https?:\/\//i.test(event.conferencing.trim()) ? (
                  <a href={event.conferencing.trim()} target="_blank" rel="noopener noreferrer" style={{ color: "var(--c-text-1)", textDecoration: "underline", textUnderlineOffset: 2, overflowWrap: "anywhere" }}>
                    {event.conferencing}
                  </a>
                ) : event.conferencing}
              </DetailRow>
            )}
            {event.meeting_notes && <DetailRow icon={<FileText size={14} />}>{event.meeting_notes}</DetailRow>}
            {event.location && <DetailRow icon={<MapPin size={14} />}>{event.location}</DetailRow>}
          </div>
        )}

        <div style={{ paddingTop: 16, borderTop: "1px solid var(--c-border-sub)" }}>
          <FieldLabel>Description</FieldLabel>
          <RichText text={event.description} empty="No description." />
        </div>

        {deleteError && <StatusBanner message={deleteError} onDismiss={() => setDeleteError("")} />}
      </div>
    </DialogCard>
  );
}
