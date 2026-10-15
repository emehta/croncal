/**
 * Google Calendar's eleven event colours, the only ones an event in Google
 * can carry, with Google's id for each. In the order of the spectrum (reds,
 * orange, yellow, greens, blues, purples, then grey), which is how the event
 * form lays them out, not Google's own order, which reads as random.
 */
export const GOOGLE_COLORS = [
  { id: "11", value: "#D50000", label: "Tomato" },
  { id: "4", value: "#E67C73", label: "Flamingo" },
  { id: "6", value: "#F4511E", label: "Tangerine" },
  { id: "5", value: "#F6BF26", label: "Banana" },
  { id: "2", value: "#33B679", label: "Sage" },
  { id: "10", value: "#0B8043", label: "Basil" },
  { id: "7", value: "#039BE5", label: "Peacock" },
  { id: "9", value: "#3F51B5", label: "Blueberry" },
  { id: "1", value: "#7986CB", label: "Lavender" },
  { id: "3", value: "#8E24AA", label: "Grape" },
  { id: "8", value: "#616161", label: "Graphite" },
] as const;
