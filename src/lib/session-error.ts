/**
 * Marks a 401 as "your session is the problem" rather than "a service
 * you connected is".
 *
 * Both come back as 401 from the same routes (an expired login token and a
 * disconnected Google account), and the client has to tell them apart: the
 * first is worth retrying on a fresh token, the second never is.
 */
export const SESSION_ERROR_CODE = "session_invalid";
