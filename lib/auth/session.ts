// Re-export barrel so existing imports like `@/lib/auth/session` resolve.
export { createSession, getSession, deleteSession, signout } from "@/lib/session";
