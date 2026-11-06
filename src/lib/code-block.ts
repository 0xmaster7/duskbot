/** The fence info arrives split: the first word rides on the code element's language class and the
 * rest on its data.meta, so only both halves together name the language and find the wrap directive. */
export function parseFenceInfo(lang: string, meta: unknown): { lang: string; wrap: boolean } {
  const words = [...(lang ? [lang] : []), ...(typeof meta === "string" ? meta.split(/\s+/) : [])].filter(Boolean);
  const isWrap = (word: string) => word.toLowerCase() === "wrap";
  return { wrap: words.some(isWrap), lang: words.find((word) => !isWrap(word)) ?? "" };
}
