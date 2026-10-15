import { requireOwner, type Owner } from "@/selfhost/owner";

/**
 * The owner of this copy's project, from the request's session (selfhost/owner
 * checks the token and the owner flag), with their id as `id`. A refusal is
 * the SetupError selfhost/owner throws, which handleRouteError answers.
 */
export async function requireAuthenticatedRequest(request: Request): Promise<Owner & { id: string }> {
  const owner = await requireOwner(request);
  return { ...owner, id: owner.userId };
}
