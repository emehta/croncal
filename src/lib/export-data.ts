import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/supabase-paging";
import { toDateStr } from "@/lib/date-utils";
import type { CalendarEvent } from "@/types/calendar-event";

/**
 * Every event CronCal keeps (Google's stay in Google), as one JSON file the
 * browser saves. Supabase's free plan keeps no daily backups, so this is the
 * user's own copy. Paged, with a unique last ordering column, so a calendar
 * past 1,000 rows comes out whole.
 */
export async function downloadMyData(): Promise<{ events: number }> {
  const events = await fetchAllRows<CalendarEvent>(() => supabase.from("calendar_events").select("*").order("start_time").order("id"));
  const body = { app: "croncal", version: 1, exported_at: new Date().toISOString(), events };
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(body, null, 2)}\n`], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `croncal-${toDateStr(new Date())}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { events: events.length };
}
