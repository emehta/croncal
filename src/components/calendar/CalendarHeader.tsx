"use client";

import { CaretLeft, CaretRight, Plus } from "@phosphor-icons/react";
import {
  dayWindow,
  formatWindowLabel,
  formatWindowLabelShort,
  weekBadge,
  windowMonth,
  type DayWindow,
} from "@/lib/calendar-range";
import { MONTH_NAMES, MONTHS_SHORT } from "@/lib/date-utils";
import { usePhone } from "@/lib/use-viewport-width";
import { CALENDAR_COLUMN_GAP, CALENDAR_SIDEBAR_WIDTH, PAGE_HEADER_GAP, PAGE_HEADER_HEIGHT, SELECTED } from "@/lib/styles";

interface CalendarHeaderProps {
  view: "day" | "week" | "month";
  currentDate: Date;
  onViewChange: (view: "day" | "week" | "month") => void;
  onDateChange: (date: Date) => void;
  onToday: () => void;
  /** Shown on a phone only, where there is no drag to create with. */
  onNewEvent?: () => void;
  /**
   * The days the week grid actually has on screen. The week view is a
   * continuous strip, so these are rarely one calendar week; the title, the
   * range and the week badge all describe this window, never the calendar
   * week around `currentDate`. See lib/calendar-range.
   */
  weekWindow: DayWindow;
}

const VIEWS: { value: "day" | "week" | "month"; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

function navigate(view: "day" | "week" | "month", date: Date, dir: -1 | 1): Date {
  const d = new Date(date);
  if (view === "day") d.setDate(d.getDate() + dir);
  else if (view === "week") d.setDate(d.getDate() + dir * 7);
  else d.setMonth(d.getMonth() + dir);
  return d;
}

/*
 * Sized to the page header row, not to its contents.
 *
 * 1px border + 2px padding on each side leaves NAV_ITEM_HEIGHT in the middle,
 * so the whole cluster comes to PAGE_HEADER_HEIGHT. Any taller and it would
 * win the row and drop the centred title below its place.
 */
const NAV_ITEM_HEIGHT = PAGE_HEADER_HEIGHT - 2 * (1 + 2);

const NAV_CONTAINER: React.CSSProperties = {
  background: "var(--c-surface)",
  border: "1px solid var(--c-border)",
  borderRadius: "var(--ui-radius-md)",
  padding: "2px 4px",
  display: "flex",
  alignItems: "center",
  gap: 2,
  boxShadow: "var(--shadow-xs)",
};

/* Height rather than vertical padding, so a pill and an icon button are the
   same height by construction instead of by arithmetic on a line box. */
const PILL_BASE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: NAV_ITEM_HEIGHT,
  padding: "0 14px",
  borderRadius: "var(--ui-radius-md)",
  fontSize: "var(--ui-type-body-sm)",
  cursor: "pointer",
  transition: "var(--transition-ui)",
};

const PILL_ACTIVE: React.CSSProperties = {
  ...PILL_BASE,
  ...SELECTED,
};

const PILL_INACTIVE: React.CSSProperties = {
  ...PILL_BASE,
  background: "transparent",
  border: "1px solid transparent",
  color: "var(--c-text-3)",
  fontWeight: 400,
};

const ICON_BTN: React.CSSProperties = {
  background: "transparent",
  border: "1px solid transparent",
  color: "var(--c-text-3)",
  width: NAV_ITEM_HEIGHT,
  height: NAV_ITEM_HEIGHT,
  borderRadius: "var(--ui-radius-md)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  transition: "var(--transition-ui)",
  flexShrink: 0,
};

export default function CalendarHeader({
  view,
  currentDate,
  onViewChange,
  onDateChange,
  onToday,
  onNewEvent,
  weekWindow,
}: CalendarHeaderProps) {
  const phone = usePhone();
  /*
   * What is on screen: the week grid's own window in week view, the day
   * itself in day view, and the month in month view.
   */
  const shown = view === "week" ? weekWindow : dayWindow(currentDate, 1);
  const titleMonth = view === "week" ? windowMonth(weekWindow) : { month: currentDate.getMonth(), year: currentDate.getFullYear() };
  const monthYear = `${MONTH_NAMES[titleMonth.month]} ${titleMonth.year}`;
  const badge = weekBadge(shown);
  const rangeLabel = view === "month" ? "" : formatWindowLabel(shown);

  if (phone) {
    return (
      <PhoneCalendarHeader
        view={view}
        currentDate={currentDate}
        badge={badge}
        shown={shown}
        titleMonth={titleMonth}
        onViewChange={onViewChange}
        onDateChange={onDateChange}
        onToday={onToday}
        onNewEvent={onNewEvent}
      />
    );
  }

  return (
    /* One child, so no gap; the space below is the shared PAGE_HEADER_GAP. */
    <div style={{ display: "flex", flexDirection: "column", marginBottom: PAGE_HEADER_GAP, flexShrink: 0 }}>
      {/*
        * Two columns, the same two the page uses below: the grid card and the
        * sidebar. The nav group right-aligns in the first, so its right edge
        * lands exactly on the card's, and the view switcher sits in the
        * second.
        */}
      <div style={{ display: "flex", alignItems: "center", gap: CALENDAR_COLUMN_GAP }}>
        {/* Mirrors the grid card */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        {/* Left: Month Year + range label */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          {/*
            text-2xl font-bold, as a page title is: 24px on a 32px line box,
            the PAGE_HEADER_HEIGHT the row is sized to. A tighter line box
            would leave the title shorter than its row and, centred, lower.
          */}
          <h1
            className="text-2xl font-bold"
            style={{ color: "var(--c-text-1)", flexShrink: 0, margin: 0 }}
          >
            {monthYear}
          </h1>
          {rangeLabel && (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                minHeight: 24,
                fontSize: "var(--ui-type-body-sm)",
                lineHeight: 1,
                color: "var(--c-text-3)",
              }}
            >
              {rangeLabel}
            </span>
          )}
          {(view === "week" || view === "day") && (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                minHeight: 24,
                padding: "3px 10px",
                borderRadius: "var(--ui-radius-md)",
                background: "var(--c-surface)",
                border: "1px solid var(--c-border)",
                fontSize: "var(--ui-type-caption)",
                lineHeight: 1,
                color: "var(--c-text-1)",
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {badge}
            </span>
          )}
        </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {/* Dragging across the grid makes an event too, but nothing says so: this does. */}
          {onNewEvent && (
            <button
              type="button"
              className="ui-hover-opacity-soft"
              onClick={onNewEvent}
              style={{
                height: PAGE_HEADER_HEIGHT,
                padding: "0 14px",
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "var(--c-accent-strong)",
                border: "none",
                borderRadius: "var(--ui-radius-md)",
                color: "var(--c-on-accent)",
                fontSize: "var(--ui-type-body-sm)",
                fontWeight: 600,
                cursor: "pointer",
                transition: "opacity var(--motion-base) var(--ease-out)",
              }}
            >
              <Plus size={14} weight="bold" aria-hidden="true" />
              Add event
            </button>
          )}
          {/* Nav arrows + Today, flush with the card's right edge */}
          <div style={{ ...NAV_CONTAINER, flexShrink: 0 }}>
            <button
              type="button"
              className="ui-hover-text"
              style={ICON_BTN}
              onClick={() => onDateChange(navigate(view, currentDate, -1))}
              aria-label="Previous"
            >
              <CaretLeft size={14} weight="bold" />
            </button>

            <button
              type="button"
              className="ui-hover-text"
              style={PILL_INACTIVE}
              onClick={onToday}
            >
              Today
            </button>

            <button
              type="button"
              className="ui-hover-text"
              style={ICON_BTN}
              onClick={() => onDateChange(navigate(view, currentDate, 1))}
              aria-label="Next"
            >
              <CaretRight size={14} weight="bold" />
            </button>
          </div>
          </div>
        </div>

        {/* Mirrors the sidebar */}
        <div style={{ width: CALENDAR_SIDEBAR_WIDTH, flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
          <div style={NAV_CONTAINER}>
            {VIEWS.map((v) => {
              const isActive = view === v.value;
              return (
                <button
                  key={v.value}
                  type="button"
                  aria-pressed={isActive}
                  className={isActive ? undefined : "ui-hover-text"}
                  style={isActive ? PILL_ACTIVE : PILL_INACTIVE}
                  onClick={() => onViewChange(v.value)}
                >
                  {v.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/*
 * The phone header.
 *
 * The desktop row is five things wide and sized to the grid card and the
 * 200px sidebar beside it; at 390px it would overlap itself. Here it is two rows
 * that fit at 360px: the title with the view switcher, then the range with
 * the navigation. The controls are taller than on desktop because they are
 * aimed at with a thumb, and the labels are short forms of the same facts.
 */
const PHONE_ITEM_HEIGHT = 32;

/* The nav cluster's own height (an item plus its 1px border and 2px padding
   each side), so the New button beside it lines up with it exactly. */
const PHONE_NAV_HEIGHT = PHONE_ITEM_HEIGHT + 2 * (1 + 2);
const PHONE_PILL: React.CSSProperties = { height: PHONE_ITEM_HEIGHT, padding: "0 10px" };

const PHONE_ICON_BTN: React.CSSProperties = {
  ...ICON_BTN,
  width: PHONE_ITEM_HEIGHT,
  height: PHONE_ITEM_HEIGHT,
};

function PhoneCalendarHeader({
  view,
  currentDate,
  badge,
  shown,
  titleMonth,
  onViewChange,
  onDateChange,
  onToday,
  onNewEvent,
}: {
  view: "day" | "week" | "month";
  currentDate: Date;
  badge: string;
  shown: DayWindow;
  titleMonth: { month: number; year: number };
  onViewChange: (view: "day" | "week" | "month") => void;
  onDateChange: (date: Date) => void;
  onToday: () => void;
  onNewEvent?: () => void;
}) {
  const rangeLabel = view === "month" ? "" : formatWindowLabelShort(shown);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12, flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <h1
          className="text-2xl font-bold"
          style={{ color: "var(--c-text-1)", margin: 0, whiteSpace: "nowrap", minWidth: 0 }}
        >
          {MONTHS_SHORT[titleMonth.month]} {titleMonth.year}
        </h1>
        <div style={{ ...NAV_CONTAINER, flexShrink: 0 }}>
          {VIEWS.map((v) => {
            const isActive = view === v.value;
            return (
              <button
                key={v.value}
                type="button"
                aria-pressed={isActive}
                className={isActive ? undefined : "ui-hover-text"}
                style={{ ...(isActive ? PILL_ACTIVE : PILL_INACTIVE), ...PHONE_PILL }}
                onClick={() => onViewChange(v.value)}
              >
                {v.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        {/*
          The range over its week number, not beside it. Side by side they
          need about 160px, and a phone leaves this side 134px at 360 and
          94px at 320 once the navigation is placed, so a week that crosses
          two months ("27 Sep - 3 Oct") would lose its end to an ellipsis.
        */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          {rangeLabel && (
            <span
              style={{
                fontSize: "var(--ui-type-body-sm)",
                lineHeight: 1.2,
                color: "var(--c-text-2)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                minWidth: 0,
              }}
            >
              {rangeLabel}
            </span>
          )}
          {view !== "month" && (
            <span
              style={{
                fontSize: "var(--ui-type-caption)",
                lineHeight: 1.2,
                fontWeight: 600,
                color: "var(--c-text-4)",
                whiteSpace: "nowrap",
              }}
            >
              {badge}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={NAV_CONTAINER}>
            <button
              type="button"
              className="ui-hover-text"
              style={PHONE_ICON_BTN}
              onClick={() => onDateChange(navigate(view, currentDate, -1))}
              aria-label="Previous"
            >
              <CaretLeft size={14} weight="bold" />
            </button>
            <button
              type="button"
              className="ui-hover-text"
              style={{ ...PILL_INACTIVE, ...PHONE_PILL }}
              onClick={onToday}
            >
              Today
            </button>
            <button
              type="button"
              className="ui-hover-text"
              style={PHONE_ICON_BTN}
              onClick={() => onDateChange(navigate(view, currentDate, 1))}
              aria-label="Next"
            >
              <CaretRight size={14} weight="bold" />
            </button>
          </div>
          {onNewEvent && (
            <button
              type="button"
              className="ui-hover-opacity-soft"
              onClick={onNewEvent}
              aria-label="Add event"
              title="Add event"
              style={{
                width: PHONE_NAV_HEIGHT,
                height: PHONE_NAV_HEIGHT,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                background: "var(--c-accent-strong)",
                border: "none",
                borderRadius: "var(--ui-radius-md)",
                color: "var(--c-on-accent)",
                cursor: "pointer",
                boxShadow: "var(--shadow-xs)",
                transition: "opacity var(--motion-base) var(--ease-out)",
              }}
            >
              <Plus size={18} weight="bold" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
