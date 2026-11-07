export const PDF_TEXT_LIMITS = { fileBytes: 25 * 1024 * 1024, textBytes: 256 * 1024, pages: 500, timeoutMs: 10_000 } as const;
export type PdfTextReply = { text: string } | { error: "corrupt" | "password" | "empty" | "large" | "pages" };
