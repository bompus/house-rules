// The command-line helpers of acp-panel-client.mjs: each takes its flag out of the argument list, so what
// is left is the positional arguments and any flag the client does not know, which it refuses.
/** @param {string} arg */
export const isFlagLike = (arg) => arg.startsWith("--");

/**
 * Helpers over `rawArgs`, which they empty as they take.
 * @param {string[]} rawArgs
 */
export function argParser(rawArgs) {
  return {
    /**
     * @param {string} name
     * @param {string} def
     */
    takeFlag: (name, def) => {
      const i = rawArgs.indexOf(name);
      // A value that is itself a flag is not a value: the flag stays and is refused, so a missing
      // value cannot swallow the next restriction (`--policy-option --no-web`).
      if (i >= 0 && i + 1 < rawArgs.length && !isFlagLike(rawArgs[i + 1] ?? "")) {
        const v = rawArgs[i + 1] ?? def;
        rawArgs.splice(i, 2);
        return v;
      }
      return def;
    },
    /** @param {string} name */
    takeSwitch: (name) => {
      const i = rawArgs.indexOf(name);
      if (i < 0) {
        return false;
      }
      rawArgs.splice(i, 1);
      return true;
    },
    /** Every value of a repeatable flag. @param {string} name */
    takeAll: (name) => {
      /** @type {string[]} */
      const values = [];
      for (
        let i = rawArgs.indexOf(name);
        i >= 0 && i + 1 < rawArgs.length && !isFlagLike(rawArgs[i + 1] ?? "");
        i = rawArgs.indexOf(name)
      ) {
        values.push(rawArgs[i + 1] ?? "");
        rawArgs.splice(i, 2);
      }
      return values;
    },
  };
}
