// lets the phone runner load the phone app's own typescript (node strips the types): relative imports without an
// extension resolve to the .ts file beside them, as the bundler does
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); }
    catch (error) {
      if (!/^\.\.?\//.test(specifier) || /\.[cm]?[jt]s$/.test(specifier)) throw error;
      return next(`${specifier}.ts`, context);
    }
  },
});
