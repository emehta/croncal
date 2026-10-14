"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { GearSix } from "@phosphor-icons/react";
import SettingsCard from "@/components/SettingsCard";
import Tooltip from "@/components/Tooltip";
import { APP_GUTTER, APP_GUTTER_PHONE, DOCK_ROOM, HEADER_ROOM } from "@/lib/styles";
import { usePhone } from "@/lib/use-viewport-width";
import { APP_NAME } from "@/selfhost/constants";
import { OPEN_SETTINGS_EVENT, type SettingsSection } from "@/lib/open-settings";

/**
 * The frame around the task list: a top bar with the name and Settings,
 * over the page, so the list scrolls up under it.
 */

/* The room the list keeps at its foot (DOCK_ROOM reads it): a plain margin, as there is no dock. */
const FOOT_ROOM = "24px";

export default function AppShell({
  children,
  signupsOpen,
  projectRefValue,
}: {
  children: ReactNode;
  signupsOpen: boolean | null;
  projectRefValue: string | null;
}) {
  const phone = usePhone();
  const barRef = useRef<HTMLElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>(undefined);

  // Anything can ask for Settings at a section (lib/open-settings): the calendar's Connect Google does.
  useEffect(() => {
    const open = (event: Event) => {
      setSettingsSection((event as CustomEvent<{ section?: SettingsSection }>).detail?.section);
      setSettingsOpen(true);
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, open);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, open);
  }, []);

  // The page pads itself by the bar's height (HEADER_ROOM), so the bar writes it.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const root = document.documentElement;
    const write = () => root.style.setProperty("--app-header-height", `${bar.offsetHeight}px`);
    write();
    const observer = new ResizeObserver(write);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--app-header-height");
    };
  }, []);

  const gutter = phone ? APP_GUTTER_PHONE : APP_GUTTER;

  return (
    <>
      <div
        style={{
          flex: "1 1 0%",
          minHeight: 0,
          display: "flex",
          position: "relative",
          overflow: "clip",
          ["--app-nav-clearance" as string]: FOOT_ROOM,
        } as CSSProperties}
      >
        <header
          ref={barRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            // Above a task being dragged (TaskList, 30) and below cards (Modal, 50).
            zIndex: 41,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: `10px ${gutter}px`,
            background: "color-mix(in srgb, var(--page-bg) 84%, transparent)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            borderBottom: "1px solid var(--c-border-sub)",
          }}
        >
          <span style={{ fontWeight: 700, fontSize: "var(--ui-type-body)", letterSpacing: "-0.01em", color: "var(--c-text-1)" }}>
            {APP_NAME}
          </span>
          <Tooltip label="Settings">
            <button
              type="button"
              aria-label="Settings"
              onClick={() => {
                setSettingsSection(undefined);
                setSettingsOpen(true);
              }}
              className="ui-hover-fill"
              style={{
                width: 36,
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "none",
                borderRadius: "var(--ui-radius-md)",
                background: "transparent",
                color: "var(--c-text-2)",
                cursor: "pointer",
              }}
            >
              <GearSix size={20} weight="duotone" />
            </button>
          </Tooltip>
        </header>
        <main
          className="dot-grid-bg"
          style={{
            flex: "1 1 0%",
            overflowY: "auto",
            overflowX: "hidden",
            padding: phone ? `calc(16px + ${HEADER_ROOM}) ${gutter}px 0` : `calc(24px + ${HEADER_ROOM}) ${gutter}px 0`,
            scrollPaddingTop: HEADER_ROOM,
            scrollPaddingBottom: DOCK_ROOM,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {children}
          <div aria-hidden="true" style={{ flex: `0 0 ${DOCK_ROOM}`, pointerEvents: "none" }} />
        </main>
      </div>
      {settingsOpen && (
        <SettingsCard onClose={() => setSettingsOpen(false)} signupsOpen={signupsOpen} projectRefValue={projectRefValue} section={settingsSection} />
      )}
    </>
  );
}
