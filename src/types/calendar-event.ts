export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  start_time: string; // ISO 8601 timestamp
  end_time: string;   // ISO 8601 timestamp
  all_day: boolean;
  timezone: string;
  recurrence: 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly' | null;
  participants: string | null;
  conferencing: string | null;
  meeting_notes: string | null;
  location: string | null;
  color: string;
  importance?: 'low' | 'medium' | 'high' | null;
  event_type?: 'work' | 'relaxation' | 'admin' | 'free' | 'personal' | null;
  source?: 'croncal' | 'google';
  google_event_id?: string | null;
  sync_to_google?: boolean;
  recurrence_until?: string | null;
  recurrence_exceptions?: string[] | null;
  recurrence_parent_id?: string | null;
  original_occurrence_start?: string | null;
  /** Only on an event read from Google, and never stored in Supabase. */
  google?: GoogleEventMeta;
  created_at: string;
}

/** A repeat the event form offers. */
export type EventRepeat = NonNullable<CalendarEvent["recurrence"]>;

/**
 * A Google series' repeat as the form shows it: one of the form's own, none,
 * or "custom" for a rule the form cannot say exactly (every Mon, Wed and
 * Fri), which is left as Google has it unless another repeat is chosen.
 */
export type RepeatChoice = EventRepeat | "none" | "custom";

/** What CronCal knows about a Google event beyond the fields it shares with its own. */
export interface GoogleEventMeta {
  /** The series this is one day of (Google's recurringEventId), or null for a one-off. */
  seriesId: string | null;
  /** Only the organiser of an ordinary event can split its series from one day onwards. */
  canSplit: boolean;
  /** The owner said no to this invitation: Home leaves it off their day. */
  declined?: boolean;
  /**
   * The series' repeat. A one-off is "none" from the start; a day of a series
   * learns its series' rule only when it is opened for editing.
   */
  repeat?: RepeatChoice;
  /** How a "custom" repeat reads: "Every week on Mon, Wed and Fri". */
  repeatLabel?: string | null;
}

/** Which days of a repeating event a change or a deletion is for. */
export type RecurrenceEditScope = "single" | "following" | "all";

/**
 * What a save changes on a Google event, and only what it changes: an absent
 * key is left as Google has it. Times travel together, all four at once.
 */
export interface GoogleEventChanges {
  title?: string;
  description?: string | null;
  location?: string | null;
  participants?: string | null;
  start_time?: string;
  end_time?: string;
  all_day?: boolean;
  timezone?: string;
  /** One of Google's eleven colours, as its hex. */
  color?: string;
  importance?: CalendarEvent["importance"];
  event_type?: CalendarEvent["event_type"];
  link?: string | null;
  repeat?: EventRepeat | "none";
}

/**
 * A new event for Google Calendar: everything the event form holds, under
 * the same names as a change, with the title and times required.
 */
export interface GoogleEventCreate extends GoogleEventChanges {
  title: string;
  start_time: string;
  end_time: string;
  all_day: boolean;
  timezone: string;
}
