/**
 * Where a task sits within its day.
 *
 * One stored number decides the order on screen, `display_order`, and the
 * owner's rule for it (29 Sep 2026) has two halves:
 *
 * 1. **A task lands by priority.** Adding one, changing its priority, or
 *    moving it to another day places it directly below the last open task on
 *    that day of the same or a higher priority, or at the top if there is
 *    none: a new Critical goes to the top, under any other Criticals, and a
 *    High never lands below a Medium. It used to go to the end of the day, so
 *    High sat under Medium.
 *
 *    "Below the last as important", not "above the first less important": on
 *    a clean day they are the same spot, but on a day the owner has arranged
 *    by hand (a Low dragged to the top, say) the second would put a new
 *    Medium above a High. This way a new task is never above anything that
 *    matters more.
 * 2. **A drag is final.** Dropping a task somewhere stores exactly that spot
 *    (the page's move handler, not this module), and nothing here re-sorts a
 *    day afterwards. That is why this places one task rather than sorting the
 *    list: sorting on read would undo every arrangement the owner made.
 *
 * Pure and exported so `scripts/task-order.test.mjs` can hold it to that.
 */

import { PRIORITY_ORDER, type Priority, type Task } from "@/types/task";

export const DISPLAY_ORDER_STEP = 1024;

type Ordered = Pick<Task, "id" | "display_order" | "created_at">;
type Placed = Pick<Task, "id" | "due_date" | "display_order" | "created_at" | "priority" | "completed">;

/** The order a day is drawn in: the stored number, then creation time. */
export function sortTasksForDisplay<T extends Ordered>(taskList: readonly T[]): T[] {
  return [...taskList].sort((a, b) => {
    const orderDelta = (a.display_order ?? 0) - (b.display_order ?? 0);
    if (orderDelta !== 0) return orderDelta;
    return a.created_at.localeCompare(b.created_at);
  });
}

/* A priority the four do not name (a null written by hand) goes last. */
function rankOf(priority: Priority): number {
  return PRIORITY_ORDER[priority] ?? Object.keys(PRIORITY_ORDER).length;
}

type Ranked = Ordered & Pick<Task, "priority">;

/**
 * The calendar's order for a day: Critical, High, Medium, Low, whatever
 * order the day has on /tasks. Within one priority it keeps that page's
 * order (the stored number, then creation time), so two Highs arranged by
 * hand stay as arranged.
 *
 * The calendar shows the first four of a day and folds the rest into
 * "+N more", so this decides which tasks are seen there at all. It drew the
 * page's order, and a Low dragged to the top on /tasks put two Criticals out
 * of sight.
 */
export function sortTasksByPriority<T extends Ranked>(taskList: readonly T[]): T[] {
  return [...taskList].sort((a, b) => {
    const rankDelta = rankOf(a.priority) - rankOf(b.priority);
    if (rankDelta !== 0) return rankDelta;
    const orderDelta = (a.display_order ?? 0) - (b.display_order ?? 0);
    if (orderDelta !== 0) return orderDelta;
    const createdDelta = (a.created_at ?? "").localeCompare(b.created_at ?? "");
    if (createdDelta !== 0) return createdDelta;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Each day's open tasks in the calendar's order, keyed by `YYYY-MM-DD`.
 * Done and undated tasks are left out: the calendar has nowhere to put them.
 */
export function openTasksByDay<T extends Ranked & Pick<Task, "due_date" | "completed">>(
  taskList: readonly T[],
): Map<string, T[]> {
  const byDay = new Map<string, T[]>();
  for (const task of taskList) {
    if (task.completed || !task.due_date) continue;
    const day = byDay.get(task.due_date);
    if (day) day.push(task);
    else byDay.set(task.due_date, [task]);
  }
  for (const [day, dayTasks] of byDay) byDay.set(day, sortTasksByPriority(dayTasks));
  return byDay;
}

export interface Placement {
  /** The order the placed task takes. */
  displayOrder: number;
  /**
   * Other tasks on that day that have to move to make room, when the two
   * neighbours are already adjacent integers. Usually empty.
   */
  renumber: Array<{ id: string; display_order: number }>;
}

/**
 * The display order for a task arriving on `dueDate` with `priority`.
 *
 * `excludeId` is the task itself when it already exists, so it is not counted
 * as its own neighbour. Only open tasks decide the spot, because done ones are
 * not in the list being arranged; they keep whatever numbers they have.
 */
export function placeByPriority(
  taskList: readonly Placed[],
  { dueDate, priority, excludeId }: { dueDate: string | null; priority: Priority; excludeId?: string },
): Placement {
  const day = sortTasksForDisplay(
    taskList.filter((task) => task.due_date === dueDate && task.id !== excludeId),
  );
  const rank = PRIORITY_ORDER[priority];
  let lastAsImportant = -1;
  day.forEach((task, index) => {
    if (!task.completed && PRIORITY_ORDER[task.priority] <= rank) lastAsImportant = index;
  });
  const at = lastAsImportant + 1;

  if (at >= day.length) {
    const last = day[day.length - 1];
    return { displayOrder: last ? last.display_order + DISPLAY_ORDER_STEP : DISPLAY_ORDER_STEP, renumber: [] };
  }

  const next = day[at];
  const prev = at > 0 ? day[at - 1] : null;
  if (!prev) {
    return { displayOrder: next.display_order - DISPLAY_ORDER_STEP, renumber: [] };
  }

  const midpoint = Math.floor((prev.display_order + next.display_order) / 2);
  if (midpoint > prev.display_order && midpoint < next.display_order) {
    return { displayOrder: midpoint, renumber: [] };
  }

  /*
   * No integer left between the neighbours: renumber the day in its current
   * order with the new task in its slot. Only the tasks whose number actually
   * changes are returned, so a write goes out for those alone.
   */
  const renumber: Placement["renumber"] = [];
  let displayOrder = 0;
  const slots = [...day.slice(0, at).map((t) => t as Placed | null), null, ...day.slice(at)];
  slots.forEach((task, index) => {
    const value = (index + 1) * DISPLAY_ORDER_STEP;
    if (task === null) {
      displayOrder = value;
    } else if (task.display_order !== value) {
      renumber.push({ id: task.id, display_order: value });
    }
  });
  return { displayOrder, renumber };
}

export interface Arrival {
  /** The id the new task will be inserted with. */
  id: string;
  dueDate: string | null;
  priority: Priority;
}

export interface BatchPlacement {
  /** Each arrival's order, by its id. */
  displayOrders: Map<string, number>;
  /** Tasks already in the list that have to move, as in Placement. */
  renumber: Array<{ id: string; display_order: number }>;
}

/**
 * Display orders for several new tasks at once, as Ramble adds them.
 *
 * placeByPriority alone, called once per task against the same list, gave
 * every new task on a day the same number: none of them could see the ones
 * placed before it. Here each lands in the list as it stands after the ones
 * before it, in the order given, so four new Mediums on a day come out in
 * the order they were said, below the Highs and above the Lows, as four
 * adds one after another would.
 *
 * An arrival that a later one forces to renumber just takes its new number
 * here; only tasks already in the list are returned to be written.
 */
export function placeManyByPriority(taskList: readonly Placed[], arrivals: readonly Arrival[]): BatchPlacement {
  const original = new Map(taskList.map((task) => [task.id, task.display_order]));
  let running: Placed[] = [...taskList];

  arrivals.forEach((arrival, index) => {
    const { displayOrder, renumber } = placeByPriority(running, {
      dueDate: arrival.dueDate,
      priority: arrival.priority,
    });
    if (renumber.length > 0) {
      const moved = new Map(renumber.map((r) => [r.id, r.display_order]));
      running = running.map((task) => {
        const order = moved.get(task.id);
        return order === undefined ? task : { ...task, display_order: order };
      });
    }
    running.push({
      id: arrival.id,
      due_date: arrival.dueDate,
      priority: arrival.priority,
      display_order: displayOrder,
      completed: false,
      /* Only a tiebreak between equal orders, which placement never makes;
         kept in arrival order all the same. */
      created_at: `~${String(index).padStart(6, "0")}`,
    });
  });

  const arrivalIds = new Set(arrivals.map((arrival) => arrival.id));
  const displayOrders = new Map<string, number>();
  const renumber: BatchPlacement["renumber"] = [];
  for (const task of running) {
    if (arrivalIds.has(task.id)) displayOrders.set(task.id, task.display_order);
    else if (original.get(task.id) !== task.display_order) renumber.push({ id: task.id, display_order: task.display_order });
  }
  return { displayOrders, renumber };
}
