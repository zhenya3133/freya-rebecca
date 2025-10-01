// apps/web/src/types/ambient.d.ts
declare module "pdf-parse";
declare module "pdf-parse/lib/pdf-parse.js";

// Если по-прежнему не хочешь тянуть @types/pg, можно оставить и это:
declare module "pg" {
  export class Pool {
    constructor(config?: any);
    query: (text: string, params?: any[]) => Promise<any>;
    end: () => Promise<void>;
  }
}
