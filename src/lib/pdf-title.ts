export const TITLE_SMALL_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with",
]);

/** The filename is the only title we have; preserve existing capitalization. */
export function displayName(name: string): string {
  const base = name.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!base) return name;
  if (base !== base.toLowerCase()) return base;
  return base.split(" ").map((word, index) => {
    const bare = word.replace(/[^a-z0-9]/gi, "");
    if (index > 0 && TITLE_SMALL_WORDS.has(bare)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(" ");
}
