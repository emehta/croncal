import { requireOwner } from "@/selfhost/owner";
import { SetupError } from "@/selfhost/server";

/** A request refused for who sent it, with the status and words to answer it with. */
export class AuthAccessError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthAccessError";
    this.status = status;
  }
}

/**
 * The owner of this copy's project, from the request's session (selfhost/owner
 * checks the token and the owner flag). The Google routes need only the id.
 */
export async function requireAuthenticatedRequest(request: Request): Promise<{ id: string }> {
  try {
    return { id: (await requireOwner(request)).userId };
  } catch (error) {
    if (error instanceof SetupError) throw new AuthAccessError(error.message, error.status);
    throw error;
  }
}
