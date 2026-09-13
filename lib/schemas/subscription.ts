import { z } from "zod";

export const checkoutSchema = z.object({
  plan: z.enum(["MONTHLY", "YEARLY"]),
});

export const cancelSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const changePlanSchema = z.object({
  plan: z.enum(["FREE", "MONTHLY", "YEARLY"]),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type CancelInput = z.infer<typeof cancelSchema>;
export type ChangePlanInput = z.infer<typeof changePlanSchema>;
