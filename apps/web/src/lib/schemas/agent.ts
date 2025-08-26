import { z } from "zod";

export const AgentSpecSchema = z.object({
  name: z.string().min(3).max(60),
  purpose: z.string().min(10).max(500),
  inputs: z.array(z.string().min(1)).min(0).max(20),
  outputs: z.array(z.string().min(1)).min(0).max(20)
});
export type AgentSpec = z.infer<typeof AgentSpecSchema>;

export const AgentSpecArraySchema = z.array(AgentSpecSchema)
  .min(1)
  .max(50)
  .refine(arr => new Set(arr.map(a => a.name.toLowerCase())).size === arr.length,
    "Имена агентов должны быть уникальны");
