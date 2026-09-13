// Re-export barrel so existing imports like `@/lib/auth/verify` resolve.
export {
  sendVerificationEmail,
  verifyEmail,
  resendVerificationCode,
} from "@/lib/verify";
