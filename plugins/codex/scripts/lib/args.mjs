export function parseArgs(argv, config = {}) {
  const valueOptions = new Set(config.valueOptions ?? []);
  const booleanOptions = new Set(config.booleanOptions ?? []);
  const aliasMap = config.aliasMap ?? {};
  const options = {};
  const positionals = [];
  const unknownOptions = [];
  let passthrough = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (passthrough) {
      positionals.push(token);
      continue;
    }

    if (token === "--") {
      passthrough = true;
      continue;
    }

    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }

    if (token.startsWith("--")) {
      const [rawKey, inlineValue] = token.slice(2).split("=", 2);
      const key = aliasMap[rawKey] ?? rawKey;

      if (booleanOptions.has(key)) {
        options[key] = inlineValue === undefined ? true : inlineValue !== "false";
        continue;
      }

      if (valueOptions.has(key)) {
        const nextValue = inlineValue ?? argv[index + 1];
        if (nextValue === undefined) {
          throw new Error(`Missing value for --${rawKey}`);
        }
        options[key] = nextValue;
        if (inlineValue === undefined) {
          index += 1;
        }
        continue;
      }

      unknownOptions.push(token);
      positionals.push(token);
      continue;
    }

    const shortKey = token.slice(1);
    const key = aliasMap[shortKey] ?? shortKey;

    if (booleanOptions.has(key)) {
      options[key] = true;
      continue;
    }

    if (valueOptions.has(key)) {
      const nextValue = argv[index + 1];
      if (nextValue === undefined) {
        throw new Error(`Missing value for -${shortKey}`);
      }
      options[key] = nextValue;
      index += 1;
      continue;
    }

    positionals.push(token);
  }

  return { options, positionals, unknownOptions };
}

export function splitRawArgumentString(raw) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaping = false;

  for (const character of raw) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }

    if (character === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (escaping) {
    current += "\\";
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

// A companion subcommand is often invoked with the whole request as a single
// argument (e.g. `codex-companion.mjs task "fix the flaky test"`). Shell-split it
// so option parsing sees individual tokens; a multi-argument argv is passed through.
export function normalizeArgv(argv) {
  if (argv.length === 1) {
    const [raw] = argv;
    if (!raw || !raw.trim()) {
      return [];
    }
    return splitRawArgumentString(raw);
  }
  return argv;
}

export function parseCommandInput(argv, config = {}) {
  const parsed = parseArgs(normalizeArgv(argv), {
    ...config,
    aliasMap: {
      C: "cwd",
      ...(config.aliasMap ?? {})
    }
  });

  // An unrecognised long option is still treated as a positional, because some
  // commands take free-form text. Say so on stderr rather than swallowing it:
  // a mistyped or unsupported flag would otherwise be silently folded into a
  // prompt, and the run would look like it did what was asked.
  for (const token of parsed.unknownOptions ?? []) {
    console.warn(
      `Warning: unrecognised option ${token}; treating it as text. It will be passed through verbatim, not interpreted as a flag.`
    );
  }

  return parsed;
}

// Command argument schemas live here so the parser and its tests share one source
// of truth. There is intentionally no short `-m` alias for `--model`: `task` and
// `review` prompts are free-form text that routinely contains tokens like
// `python -m pytest`, and a greedy `-m` alias swallowed the following word as the
// model (yielding e.g. `--model pytest` -> gateway 404) while dropping it from the
// prompt. Only the documented long `--model` form selects a model. See #699.
export function parseTaskArgv(argv) {
  return parseCommandInput(argv, {
    valueOptions: ["model", "effort", "cwd", "prompt-file", "resume-thread", "thread-title"],
    booleanOptions: ["json", "write", "read-only", "resume-last", "resume", "fresh", "background"]
  });
}

export function parseReviewArgv(argv) {
  return parseCommandInput(argv, {
    valueOptions: ["base", "scope", "model", "cwd", "effort"],
    booleanOptions: ["json", "background", "wait"]
  });
}
