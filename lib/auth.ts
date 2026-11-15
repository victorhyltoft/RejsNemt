import { createHash } from "node:crypto";

export const PASS = process.env.APP_PASSCODE || "";
export const COOKIE = "afsted_auth";
export const token = () => createHash("sha256").update("afsted:" + PASS).digest("hex").slice(0, 32);
