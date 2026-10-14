import { redirect } from "next/navigation";

/** The task list is the app; the address a user types is just the port. */
export default function Home() {
  redirect("/calendar");
}
