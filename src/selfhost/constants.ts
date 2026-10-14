/** Names shared by the server and the browser. Nothing here is secret. */

export const APP = "croncal";
export const APP_NAME = "CronCal";
/** Bump with a change to supabase/schema.sql, so an older project is asked to run it again. */
export const SCHEMA_VERSION = 1;
/** Set in app_metadata, which only the secret key can write; every table and route checks it. */
export const OWNER_FLAG = "self_host_owner";
