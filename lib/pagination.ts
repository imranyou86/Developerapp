// Page sizes for the cursor-paginated lists (Chat, Files Library) — kept
// out of their "use server" actions.ts files since a Server Actions module
// may only export async functions, not plain constants.
export const CHAT_PAGE_SIZE = 50;
export const FILES_PAGE_SIZE = 100;
