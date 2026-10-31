#!/usr/bin/env bun
// Claude Code Stop hook: holds back a final reply that says nothing is left, or that the session is complete,
// while the session's plan still has open or deferred ledger items. It needs no other service: it reads the hook
// input on stdin, the session transcript the input names, and the plan file the session itself used.
//
// The plan is the existing file the session last wrote (a Write, Edit or MultiEdit on `plans/<topic>/plan.md`)
// or last named by a shell statement that runs the floor scripts (`check-open-work.mjs`, `close-ledger-line.mjs`)
// or writes to it (`>`, `>>`, `tee`, `sed -i`). A `cd` earlier in the same command and a bare `plan.md` are
// followed. Reading a plan does not count. A path that is not a file on disk is skipped. A session that never
// touched a plan file has nothing to check, and its reply passes. A transcript with no `user` or `assistant`
// records (a Codex rollout) has no such structure, so the plan paths its tool-call text names count instead,
// read or written, the latest mention being the plan checked; a path with a space or a comma in it is not found.
//
// The shell reading is a best effort, not a shell. It counts a stored command (`C="node …/close-ledger-line.mjs
// plan.md"`) as naming that plan whether or not it is run, cannot tell which side of `||` or `&&` ran, does not carry a `cd` through the rest of a list that ends in `&`, treats a backtick substitution as plain text, lets a `cd` inside a brace group that feeds a pipe leak to later commands, does not skip the values of `node` or `bun` options (`--eval=…`, `--require x`) before the script, reads `<&` as a background marker, and resolves `..` in a plan path lexically, not through symlinks.
// A miss
// only means no block, since the hook fails open.
//
// A block is sent once: the hook input's `stop_hook_active` is true on the continuation, which always passes,
// so a stuck check cannot loop. Any read or parse failure also passes and says so on stderr.
//
// Register it in Claude Code settings (adjust the path to this checkout):
//   { "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "bun <checkout>/scripts/stop-claim-check.mjs" } ] } ] } }
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { planSnapshot } from "../skills/hr-what-next/scripts/plan-ledger.mjs";
import { replyFacts } from "./continuity-boundary.mjs";

// Text a reply only quotes is not a claim: a fenced block (fence lines at the start of a line), an inline code
// span, or a span in double quotation marks on one line. A straight quote opens only before a non-space and closes
// only after one, so a lone mark with spaces around it (an inch sign) hides nothing. A reply that describes a test
// and quotes "nothing left" says nothing about its own work. A removed span keeps its sentence-ending punctuation
// and line breaks, so a negation before a quote cannot reach the sentence after it.
const FENCE = String.raw`^[ \t]*\x60{3}[^\n]*\n[\s\S]*?\n[ \t]*\x60{3}[ \t]*$`;
const DOUBLE_QUOTED = String.raw`(?<!\w)"(?=\S)[^"\n]*(?<=\S)"(?!\w)|\u201c[^\u201c\u201d\n]*\u201d`;
const QUOTED = new RegExp(String.raw`${FENCE}|\x60[^\x60\n]+\x60|${DOUBLE_QUOTED}`, "gm");

/**
 * The reply without its fenced blocks and double-quoted spans, keeping line breaks. Inline code spans stay: a coded
 * offer prints its codes in them.
 * @param {string} reply
 */
export const unquotedProse = (reply) =>
  reply.replace(
    new RegExp(`${FENCE}|${DOUBLE_QUOTED}`, "gm"),
    (span) => ` ${span.replace(/[^.!?\n]/g, "")} `,
  );

/**
 * The reply without the text it only quotes (see QUOTED).
 * @param {string} reply
 */
export const unquoted = (reply) =>
  reply.replace(QUOTED, (span) => ` ${span.replace(/[^.!?\n]/g, "")} `);

/** @param {string} reply */
const claimsDone = (reply) => replyFacts(unquoted(reply)).done;

const PLAN_FILE = /(?:^|[\\/])plans[\\/][^\\/]+[\\/]plan\.md$/;
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);
const SUBSHELL_OPEN = "\u0000(";
const SUBSHELL_CLOSE = "\u0000)";
const PIPE = "\u0000|";
const OR = "\u0000||";
const BACKGROUND = "\u0000&";
const SEPARATOR = "\u0000;";
const RUNNERS = new Set(["node", "nodejs", "bun"]);
const FLOOR_SCRIPT = /(?:check-open-work|close-ledger-line)\.mjs/;
// Options of the floor scripts that take a value; the plan is the first word that is neither.
const FLOOR_VALUE_OPTIONS = new Set([
  "--checkout",
  "--app-managed",
  "--scratch",
  "--repo",
  "--today",
  "--session",
  "--turn",
  "--line",
  "--match",
  "--evidence",
  "--by",
  "--asked",
  "--time",
]);
// A redirection operator as a word, which no quoted or escaped `>` can equal.
const REDIRECT = "\u0000>";
// An input redirection operator as a word, for the same reason.
const INPUT = "\u0000<";
// The text after `<<`: an optional `-` (strip leading tabs from the terminator), then the delimiter word.
const HEREDOC_DELIMITER = /^(-?)\s*((?:'[^']*'|"[^"]*"|\\.|[^\s;&|<>()'"\\])+)/;

/**
 * The transcript's parsed lines. Only an unterminated last line is tolerated (the file is read while it is
 * written); any other malformed line throws, so the hook passes without checking.
 * @param {string} transcript
 */
export function entries(transcript) {
  const lines = transcript.split("\n");
  /** @type {any[]} */
  const parsed = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) {
      continue;
    }
    try {
      parsed.push(JSON.parse(line));
    } catch (error) {
      // Only the physically last line can be a record still being written.
      if (index !== lines.length - 1) {
        throw error;
      }
    }
  }
  return parsed;
}

/** @param {any} entry */
const blocks = (entry) => (Array.isArray(entry?.message?.content) ? entry.message.content : []);

/**
 * The text of the turn's last assistant message: the text blocks after the final tool call.
 * @param {any[]} list
 */
export function finalReply(list) {
  /** @type {string[]} */
  const parts = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const entry = list[i];
    if (entry?.type === "user") {
      break;
    }
    if (entry?.type !== "assistant") {
      continue;
    }
    const content = blocks(entry);
    let reachedTool = false;
    for (let j = content.length - 1; j >= 0; j--) {
      if (content[j].type === "text") {
        parts.unshift(String(content[j].text));
      } else if (content[j].type === "tool_use") {
        reachedTool = true;
        break;
      }
    }
    if (reachedTool) {
      break;
    }
  }
  return parts.join("\n").trim();
}

/**
 * Splits a shell command into statements of words. Quotes group a word, an unquoted `>` is the REDIRECT word,
 * and `;`, `&`, `|`, parentheses and newlines end a statement. Marker statements keep what the split would lose:
 * PIPE for a single `|`, OR for `||`, BACKGROUND for a single `&` and SEPARATOR for `;` or a newline. `$(` opens a
 * subshell that its `)` closes, and the word or command it interrupted continues after it. Here-document bodies are skipped: a `<<` outside quotes and
 * comments names a delimiter, and the lines after the statement's end up to it are text. One pass, so a long
 * command costs time in proportion to its size.
 * @param {string} command
 * @returns {string[][]}
 */
export function statements(command) {
  /** @type {string[][]} */
  const out = [];
  /** @type {string[]} */
  let words = [];
  let word = "";
  let started = false;
  let quote = "";
  let parens = 0;
  /** @type {{ depth: number, words: string[], word: string, quote: string }[]} the statement and word a `$(` interrupts, and the quote it sat in */
  const quoted = [];
  /** @type {{ tag: string, tabs: boolean }[]} */
  let pending = [];
  const endWord = () => {
    if (started) {
      words.push(word);
    }
    word = "";
    started = false;
  };
  const endStatement = () => {
    endWord();
    if (words.length) {
      out.push(words);
    }
    words = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i] ?? "";
    if (quote) {
      if (quote === '"' && c === "$" && command[i + 1] === "(") {
        quoted.push({ depth: parens++, words, word, quote });
        words = [];
        word = "";
        started = false;
        out.push([SUBSHELL_OPEN]);
        quote = "";
        i++;
      } else if (c === quote) {
        quote = "";
      } else if (c === "\\" && quote === '"' && command[i + 1] === "\n") {
        i++;
      } else if (c === "\\" && quote === '"' && '$`"\\'.includes(command[i + 1] ?? "")) {
        word += command[++i];
      } else {
        word += c;
      }
    } else if (c === "'" || c === '"') {
      quote = c;
      started = true;
    } else if (c === "\\" && command[i + 1] === "\n") {
      i++;
    } else if (c === "\\" && i + 1 < command.length) {
      word += command[++i];
      started = true;
    } else if (/\s/.test(c) && c !== "\n") {
      endWord();
    } else if (c === "#" && !started) {
      while (i + 1 < command.length && command[i + 1] !== "\n") {
        i++;
      }
    } else if (c === ">" && command[i + 1] === "&") {
      // Descriptor duplication (`2>&1`) stays inside the statement and names no file.
      const wasFd = started && /^\d+$/.test(word);
      if (wasFd) {
        word = "";
        started = false;
      }
      endWord();
      i++;
      while (/[\d-]/.test(command[i + 1] ?? "")) {
        i++;
      }
    } else if (c === ">") {
      if (started && /^\d+$/.test(word)) {
        // A descriptor attached to the operator (`2>`) is part of it.
        word = "";
        started = false;
      }
      endWord();
      if (words.at(-1) !== REDIRECT) {
        words.push(REDIRECT);
      }
    } else if (c === "<" && command.startsWith("<<<", i)) {
      endWord();
      words.push(INPUT);
      i += 2;
    } else if (c === "<" && command[i + 1] === "<") {
      endWord();
      const found = HEREDOC_DELIMITER.exec(command.slice(i + 2));
      if (found) {
        const tag = (found[2] ?? "").replace(
          /'([^']*)'|"([^"]*)"|\\(.)/g,
          (_, single, double, escaped) => single ?? double ?? escaped,
        );
        pending.push({ tag, tabs: found[1] === "-" });
        i += 1 + found[0].length;
      } else {
        i++;
      }
    } else if (c === "<") {
      if (started && /^\d+$/.test(word)) {
        word = "";
        started = false;
      }
      endWord();
      words.push(INPUT);
    } else if (c === "\n" && pending.length) {
      endStatement();
      out.push([SEPARATOR]);
      for (const { tag, tabs } of pending) {
        const terminator = (/** @type {string} */ line) =>
          (tabs ? line.replace(/^\t+/, "") : line) === tag;
        let end = command.indexOf("\n", i + 1);
        while (end !== -1 && !terminator(command.slice(i + 1, end))) {
          i = end;
          end = command.indexOf("\n", i + 1);
        }
        i = end === -1 ? command.length : end;
      }
      pending = [];
    } else if (c === "(" && started && word.endsWith("$")) {
      // An unquoted `$(`: the command continues after its `)`.
      quoted.push({ depth: parens++, words, word, quote: "" });
      words = [];
      word = "";
      started = false;
      out.push([SUBSHELL_OPEN]);
    } else if (c === "(" || c === ")") {
      endStatement();
      parens += c === "(" ? 1 : -1;
      out.push([c === "(" ? SUBSHELL_OPEN : SUBSHELL_CLOSE]);
      if (c === ")" && quoted.at(-1)?.depth === parens) {
        // Back in the word the substitution interrupted.
        ({ words, word, quote } = quoted.pop() ?? { words, word, quote });
        started = true;
      }
    } else if (c === "|" && command[i + 1] !== "|") {
      endStatement();
      out.push([PIPE]);
      if (command[i + 1] === "&") {
        // `|&` pipes both streams; its `&` is not a background marker.
        i++;
      }
    } else if (c === "|" && command[i + 1] === "|") {
      endStatement();
      out.push([OR]);
      i++;
    } else if (c === "&" && command[i + 1] === ">") {
      // `&>` and `&>>` redirect both streams; the `>` that follows makes the REDIRECT word.
      endWord();
    } else if (c === "&" && command[i + 1] === "&") {
      endStatement();
      i++;
    } else if (c === "&") {
      endStatement();
      out.push([BACKGROUND]);
    } else if (";\n".includes(c)) {
      endStatement();
      if (out.length && out.at(-1)?.[0] !== SEPARATOR) {
        out.push([SEPARATOR]);
      }
    } else {
      word += c;
      started = true;
    }
  }
  endStatement();
  return out;
}

/**
 * @param {string} path
 * @param {string} dir
 */
function absolute(path, dir) {
  const expanded = path.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, homedir());
  return resolve(dir, expanded);
}

const KEYWORDS = new Set(["if", "then", "else", "elif", "do", "while", "until", "!", "{"]);
const PREFIXES = /^(?:nice|time|env|command|exec|sudo|-n|-?\d+|[A-Za-z_]\w*=[\s\S]*)$/;
const EVAL_FLAGS = new Set(["-e", "-p", "-pe", "--eval", "--print"]);

/**
 * The program a statement runs and its arguments, after shell keywords (`then`, `do`), environment assignments
 * and `nice`/`time`/`env`/`sudo` prefixes.
 * @param {string[]} words
 */
function head(words) {
  let i = 0;
  while (i < words.length && (KEYWORDS.has(words[i] ?? "") || PREFIXES.test(words[i] ?? ""))) {
    i++;
  }
  return { name: words[i] ?? "", args: words.slice(i + 1) };
}

/**
 * Whether a statement runs a floor script: the script itself, or a runner (`node`, `bun`) given it. A script
 * name that is only an argument of another program (`rg check-open-work.mjs …`) or part of a runner's inline
 * code (`node -e …`) does not count.
 * @param {{ name: string, args: string[] }} command
 */
function invokesFloor({ name, args }) {
  if (FLOOR_SCRIPT.test(name)) {
    return true;
  }
  if (!RUNNERS.has(basename(name))) {
    return false;
  }
  let j = 0;
  while ((args[j] ?? "").startsWith("-")) {
    if (EVAL_FLAGS.has(args[j] ?? "")) {
      return false;
    }
    j++;
  }
  if (args[j] === "run") {
    j++;
  }
  return FLOOR_SCRIPT.test(args[j] ?? "");
}

/** @param {string} word */
const isPlanWord = (word) => /(?:^|[\\/])plan\.md$/.test(word);

/**
 * A statement's words without its redirections: the words that remain, and the files it writes to.
 * @param {string[]} words
 */
function splitRedirections(words) {
  /** @type {string[]} */
  const plain = [];
  /** @type {string[]} */
  const redirected = [];
  for (let index = 0; index < words.length; index++) {
    const word = words[index] ?? "";
    if (word === REDIRECT) {
      redirected.push(words[++index] ?? "");
    } else if (word === INPUT) {
      index++;
    } else {
      plain.push(word);
    }
  }
  return { plain, redirected };
}

/**
 * The plan files a statement writes or hands to a floor script. A floor script's plan is its first operand that
 * is not an option, an option's value or a redirection (`--match plans/x/plan.md`, `> /dev/null`).
 * @param {string[]} words
 * @returns {string[]}
 */
function writeTargets(words) {
  const { plain, redirected } = splitRedirections(words);
  const assigned =
    /^[A-Za-z_]\w*=(?:node|nodejs|bun)\s+\S*(?:check-open-work|close-ledger-line)\.mjs/;
  const command = head(plain);
  // A stored command (`C="node …/close-ledger-line.mjs plan.md"`) counts: sessions here run it as `$C`.
  if (assigned.test(plain[0] ?? "") || invokesFloor(command)) {
    const expanded = plain.flatMap((word) => (assigned.test(word) ? word.split(/\s+/) : [word]));
    const args = expanded.slice(expanded.findIndex((word) => FLOOR_SCRIPT.test(word)) + 1);
    let operand;
    for (let index = 0; index < args.length && operand === undefined; index++) {
      const word = args[index] ?? "";
      if (FLOOR_VALUE_OPTIONS.has(word)) {
        index++;
      } else if (!word.startsWith("-")) {
        operand = word;
      }
    }
    const plan = operand !== undefined && isPlanWord(operand) ? [operand] : [];
    return [...plan, ...redirected.filter(isPlanWord)];
  }
  const name = basename(command.name);
  const sed = name === "sed" && command.args.some((word) => /^-[Enrsuz]*i|^--in-place/.test(word));
  if (sed || name === "tee") {
    return [...command.args.filter(isPlanWord), ...redirected.filter(isPlanWord)];
  }
  return redirected.filter(isPlanWord);
}

/**
 * Whether the statement at `index` is part of a list that ends in `&`: a marker for it comes before the next `;`
 * or newline.
 * @param {string[][]} list
 * @param {number} index
 */
function backgrounded(list, index) {
  let depth = 0;
  for (let next = index + 1; next < list.length && list[next]?.[0] !== SEPARATOR; next++) {
    const marker = list[next]?.[0];
    if (marker === SUBSHELL_OPEN) {
      depth++;
    } else if (marker === SUBSHELL_CLOSE) {
      depth--;
    } else if (marker === BACKGROUND && depth === 0) {
      return true;
    }
    if (depth < 0) {
      return false;
    }
  }
  return false;
}

/**
 * Plan files one shell command writes or hands to a floor script, in statement order.
 * @param {string} command
 * @param {string} startDir
 */
function commandPlans(command, startDir) {
  /** @type {string[]} */
  const found = [];
  let dir = startDir;
  /** @type {string | undefined} the directory `cd -` returns to, once a cd has run */
  let previous;
  /** @type {{ dir: string, previous: string | undefined }[]} */
  const outer = [];
  const list = statements(command);
  for (const [index, words] of list.entries()) {
    if (words[0] === SUBSHELL_OPEN) {
      outer.push({ dir, previous });
      continue;
    }
    if (words[0] === SUBSHELL_CLOSE) {
      ({ dir, previous } = outer.pop() ?? { dir, previous });
      continue;
    }
    if (words[0] === PIPE || words[0] === OR || words[0] === BACKGROUND || words[0] === SEPARATOR) {
      continue;
    }
    const { name, args } = head(splitRedirections(words).plain);
    if (name === "cd") {
      // A pipeline side or a background list runs in its own shell, so its directory change does not last.
      const piped =
        list[index - 1]?.[0] === PIPE || list[index + 1]?.[0] === PIPE || backgrounded(list, index);
      // After `||` the cd runs only when the left side failed, which a transcript cannot tell.
      const conditional = list[index - 1]?.[0] === OR;
      const operand = args.find((word) => !/^(?:--|-[LPe@]+)$/.test(word));
      const target = operand === "-" ? previous : (operand ?? homedir());
      if (target && !piped && !conditional) {
        previous = dir;
        dir = absolute(target, dir);
      }
      continue;
    }
    for (const target of writeTargets(words).filter(isPlanWord)) {
      const path = absolute(target, dir);
      if (PLAN_FILE.test(path)) {
        found.push(path);
      }
    }
  }
  return found;
}

/**
 * Plan files the session wrote or named in shell commands, oldest first. Paths may not exist.
 * @param {any[]} list
 * @param {string} base the directory relative paths resolve against when an entry carries none
 */
export function planPaths(list, base) {
  /** @type {string[]} */
  const paths = [];
  const failed = new Set(
    list.flatMap((entry) =>
      blocks(entry)
        .filter((/** @type {any} */ block) => block.type === "tool_result" && block.is_error)
        .map((/** @type {any} */ block) => block.tool_use_id),
    ),
  );
  for (const entry of list) {
    if (entry?.type !== "assistant") {
      continue;
    }
    const dir = typeof entry.cwd === "string" ? entry.cwd : base;
    for (const block of blocks(entry)) {
      if (block.type !== "tool_use") {
        continue;
      }
      const input = block.input ?? {};
      if (WRITE_TOOLS.has(block.name) && typeof input.file_path === "string") {
        if (PLAN_FILE.test(input.file_path) && !failed.has(block.id)) {
          paths.push(absolute(input.file_path, dir));
        }
      } else if (block.name === "Bash" && typeof input.command === "string") {
        // A failed call still counts: its exit status covers the whole command, so it cannot say which write
        // failed, and the plan is one the session meant to change (an absent file is skipped later).
        paths.push(...commandPlans(input.command, dir));
      }
    }
  }
  return paths;
}

// Characters that end a path token in command text; a path with one of them is not found by the fallback.
const PATH_END = /[\s"'`\\<>|;&(),={}[\]]/;
const PLAN_TOKEN = /^(?:~|\$HOME|\$\{HOME\}|)(?:\/[^/]+)*\/plans\/[A-Za-z0-9._-]+\/plan\.md$/;
const PLAN_TAIL = "/plan.md";
const MAX_TOKEN = 512;

/**
 * The plan paths one string of command text names, in order. It finds each `/plan.md`, takes the token around it
 * (at most MAX_TOKEN characters back to a delimiter) and keeps it when the token is a `plans/<topic>/plan.md`
 * path starting with `~`, `$HOME` or `/` that ends at the file name. It never scans more than MAX_TOKEN
 * characters per occurrence, so a long run of path characters costs time in proportion to its length.
 * @param {string} text
 */
function planTokens(text) {
  /** @type {string[]} */
  const tokens = [];
  for (let at = text.indexOf(PLAN_TAIL); at !== -1; at = text.indexOf(PLAN_TAIL, at + 1)) {
    const end = at + PLAN_TAIL.length;
    // The file name must end the token: the end of the text or a delimiter, so `plan.md~`, `plan.md.bak` and
    // `plan.md2` are other files.
    const after = text.charAt(end);
    if (after !== "" && !PATH_END.test(after)) {
      continue;
    }
    let start = at;
    while (start > 0 && at - start < MAX_TOKEN && !PATH_END.test(text.charAt(start - 1))) {
      start--;
    }
    const token = text.slice(start, end);
    if (PLAN_TOKEN.test(token)) {
      tokens.push(token);
    }
  }
  return tokens;
}

/** The strings of a Codex rollout's tool-call records: the code or arguments the model sent, not their output. */
const toolCallText = (/** @type {any} */ entry) =>
  entry?.type === "response_item" && entry.payload && String(entry.payload.type).endsWith("_call")
    ? [entry.payload.input, entry.payload.arguments].filter((value) => typeof value === "string")
    : [];

/**
 * The plan files named in the tool calls of a transcript whose records are not Claude Code's (a Codex rollout),
 * oldest mention first. The records' own structure is not parsed beyond finding the call text, so it cannot tell a
 * plan the session wrote from one it only read: both count.
 * @param {any[]} list
 * @param {string} base the directory relative paths resolve against
 */
export function planPathsInCalls(list, base) {
  /** @type {Map<string, number>} */
  const last = new Map();
  // One counter step per mention, so two plans named in the same call keep the order they appear in.
  let order = 0;
  for (const entry of list) {
    for (const text of toolCallText(entry)) {
      for (const token of planTokens(text)) {
        last.set(absolute(token, base), order++);
      }
    }
  }
  return [...last].sort((a, b) => a[1] - b[1]).map(([path]) => path);
}

/**
 * The plan files the session used, oldest first. A Claude Code transcript yields the ones its tool calls wrote or
 * named, and reading a plan does not count. Any other transcript (no `user` or `assistant` records) yields the
 * ones its tool calls name, read or written.
 * @param {any[]} list the parsed transcript lines
 * @param {string} base
 */
export function sessionPlanPaths(list, base) {
  const claude = list.some((entry) => entry?.type === "assistant" || entry?.type === "user");
  return claude ? planPaths(list, base) : planPathsInCalls(list, base);
}

/**
 * @param {{ reply: string, planPath: string | undefined, planText: string | undefined }} state
 * @returns {{ block: boolean, reason?: string, note?: string }}
 */
export function decide({ reply, planPath, planText }) {
  if (!claimsDone(reply) || planPath === undefined || planText === undefined) {
    return { block: false };
  }
  const snapshot = planSnapshot(planText);
  if (snapshot.errors.length) {
    return { block: false, note: `${planPath} does not parse: ${snapshot.errors[0]}` };
  }
  if (snapshot.openItems.length === 0) {
    return { block: false };
  }
  const first = snapshot.openItems
    .slice(0, 3)
    .map((item) => `L${item.line} ${item.text.replace(/\s+/g, " ").slice(0, 80)}`)
    .join("; ");
  return {
    block: true,
    reason:
      `Your reply says nothing is left or the session is complete, but the plan ${planPath} still has ` +
      `${snapshot.openItems.length} open or deferred item(s) (${first}). Reconcile the plan, then say what ` +
      "is unfinished and what each item waits on. Do not claim completion until the open-work check is empty.",
  };
}

/**
 * @param {{ stop_hook_active?: boolean, transcript_path?: string, last_assistant_message?: string, cwd?: string }} input
 * @param {{ read: (path: string) => string | undefined }} files
 */
export function evaluate(input, files) {
  if (input.stop_hook_active) {
    return { block: false };
  }
  const transcript = input.transcript_path ? files.read(input.transcript_path) : undefined;
  const list = transcript === undefined ? [] : entries(transcript);
  const reply =
    typeof input.last_assistant_message === "string" && input.last_assistant_message.trim()
      ? input.last_assistant_message
      : finalReply(list);
  if (!claimsDone(reply)) {
    return { block: false };
  }
  for (const planPath of sessionPlanPaths(list, input.cwd ?? process.cwd()).toReversed()) {
    const planText = files.read(planPath);
    if (planText !== undefined) {
      return decide({ reply, planPath, planText });
    }
  }
  return { block: false };
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  try {
    const input = JSON.parse(readFileSync(0, "utf8"));
    const result = evaluate(input, {
      read: (path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
    });
    if (result.block) {
      process.stdout.write(JSON.stringify({ decision: "block", reason: result.reason }) + "\n");
    } else if (result.note) {
      process.stderr.write(`stop-claim-check: passed without checking (${result.note})\n`);
    }
  } catch (error) {
    process.stderr.write(
      `stop-claim-check: passed without checking (${error instanceof Error ? error.message : String(error)})\n`,
    );
  }
}
