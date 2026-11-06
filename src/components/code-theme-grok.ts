import type { ThemeRegistration } from "shiki/core";

// grok's light syntax palette (its editor theme: keyword, string, function, constant, comment over a 92% ink)
const FG = "#141414eb";
const KEYWORD = "#b3003f";
const STRING = "#9e94d5";
const FUNCTION = "#db704b";
const CONSTANT = "#206595";
const COMMENT = "#141414ad";

export const GROK_LIGHT_THEME: ThemeRegistration = {
  name: "grok-light",
  type: "light",
  colors: { "editor.foreground": FG, "editor.background": "#fcfcfc" },
  settings: [
    { settings: { foreground: FG } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: COMMENT } },
    { scope: ["keyword", "storage", "storage.type", "storage.modifier", "entity.name.tag", "variable.language", "keyword.control"], settings: { foreground: KEYWORD } },
    { scope: ["keyword.operator", "punctuation"], settings: { foreground: FG } },
    { scope: ["keyword.operator.new", "keyword.operator.expression", "keyword.operator.word", "keyword.operator.logical.python"], settings: { foreground: KEYWORD } },
    { scope: ["string", "string.unquoted.argument", "string.template", "string.regexp"], settings: { foreground: STRING } },
    { scope: ["punctuation.definition.string"], settings: { foreground: FG } },
    { scope: ["entity.name.function", "support.function", "entity.name.command", "meta.function-call.generic.python support.function"], settings: { foreground: FUNCTION } },
    { scope: ["constant", "support.constant", "entity.name.type", "entity.name.class", "support.type", "support.class", "entity.other.inherited-class", "markup.underline.link"], settings: { foreground: CONSTANT } },
    { scope: ["variable", "variable.parameter", "entity.other.attribute-name", "meta.property-name", "support.type.property-name"], settings: { foreground: FG } },
    { scope: ["support.type.property-name.json"], settings: { foreground: KEYWORD } },
  ],
};
