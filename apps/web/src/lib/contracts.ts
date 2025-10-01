// apps/web/src/lib/contracts.ts
export type InitiativeStatus = "created" | "completed" | "failed";

export type Initiative = {
  id: string;
  task: string;
  ns: string;
  status: InitiativeStatus;
  createdAt: string;
};

export type EventType =
  | "initiative.created"
  | "artifact.created"
  | "review.required"
  | "sla.breached"
  | "error";

export type Event = {
  id: string;
  initiativeId: string;
  type: EventType;
  payload: any;
  at: string;
};

export type SourceRef = { title: string; url?: string; score?: number };

export type Artifact = {
  id: string;
  initiativeId: string;
  type: "answer/text" | "agent_lineup";
  answer: string;
  sources: SourceRef[];
  model: string;
  tokens: { prompt: number; completion: number };
  cost: number; // USD
  createdAt: string;
};
