// tel: links work with most formatting, but stripping to digits (keeping a
// leading +) is the most reliably dialable form across phone apps rather
// than passing through however the number was typed in (parens, dashes,
// extra spaces).
export function telHref(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, "");
  return `tel:${cleaned}`;
}
