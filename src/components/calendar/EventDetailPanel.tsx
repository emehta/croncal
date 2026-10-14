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
} from "@phosphor-icons/react";
import type { CalendarEvent } from "@/types/calendar-event";
import { describeRecurrence } from "@/lib/recurrence";
import { useTimeFormat, formatTime } from "@/lib/time-format";
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

function formatDateLine(date: Date): string {
  const day = DAYS_SHORT[date.getDay()];
  const d = date.getDate();
  const month = MONTHS_SHORT[date.getMonth()];
  const year = date.getFullYear();
  return `${day}, ${month} ${d}, ${year}`;
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
    : `${formatTime(start, fmt)} – ${formatTime(end, fmt)} · ${formatDuration(start, end)}`;
  const dateStr = isSameDay(start, end)
    ? formatDateLine(start)
    : `${formatDateLine(start)} – ${formatDateLine(end)}`;
  const recurrenceDesc = event.recurrence
    ? describeRecurrence(event.recurrence, new Date(event.start_time))
    : null;

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await onDelete(event.id);
    } catch {
      setDeleteError("Could not delete this event. Try again.");
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
          <DetailRow icon={<Globe size={14} />}>{event.timezone}</DetailRow>
          {(event.source === "google" || event.sync_to_google) && (
            <DetailRow icon={<GoogleBrandIcon size={14} />}>
              {event.source === "google" ? "From Google Calendar" : "Synced to Google Calendar"}
            </DetailRow>
          )}
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
