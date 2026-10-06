// Inspect Markdown pointers without fetching GitHub or changing files. Callers supply
// known checkout identities; pinned revisions, downloads and images remain remote.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function remoteLocalLinks(text, repositories) {
  const findings = [];
  const known = new Map(
    Object.entries(repositories).map(([name, path]) => [name.toLowerCase(), path]),
  );
  const imageReferences = new Set();
  const textReferences = new Set();
  const label = (value) => value.trim().replace(/\s+/g, " ").toLowerCase();
  for (const match of text.matchAll(/(!?)\[([^\]\n]+)\](?:\[([^\]\n]*)\])?/g)) {
    if (["(", ":"].includes(text[match.index + match[0].length])) continue;
    (match[1] ? imageReferences : textReferences).add(label(match[3] || match[2]));
  }
  let fence = null;
  for (const [index, line] of text.split("\n").entries()) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence || /^(?: {4}|\t)/.test(line)) continue;
    // Explicit upstream refresh instructions may need a newer remote document.
    if (/<!-- local-reference: (?:remote-refresh|source|download) \S.*? -->/.test(line)) continue;
    const definition = /^\s*\[([^\]]+)\]:/.exec(line);
    if (
      definition &&
      imageReferences.has(label(definition[1])) &&
      !textReferences.has(label(definition[1]))
    )
      continue;
    const urls =
      /https:\/\/(?:github\.com\/([^/\s]+\/[^/\s]+)\/(?:blob|tree)\/|raw\.githubusercontent\.com\/([^/\s]+\/[^/\s]+)\/)([^/\s]+)\/([^\s)<>"`]+)/g;
    for (const match of line.matchAll(urls)) {
      const [, githubRepository, rawRepository, ref, path] = match;
      const repository = githubRepository || rawRepository;
      const checkout = known.get(repository.toLowerCase());
      if (!checkout) continue;
      if (/^[0-9a-f]{7,40}$/i.test(ref) || /^v?\d+\.\d+\.\d+(?:[-+].*)?$/.test(ref)) continue;
      // An inline image is a rendering resource, rather than a context pointer.
      if (/!\[[^\]]*\]\(\s*$/.test(line.slice(0, match.index))) continue;
      const [pathAndQuery, anchor] = path.split("#", 2);
      const [file] = pathAndQuery.split("?", 1);
      let decoded;
      try {
        decoded = decodeURIComponent(file);
      } catch {
        findings.push({
          line: index + 1,
          url: match[0],
          repository,
          path: file,
          anchor,
          target: null,
          error: "Malformed percent-encoding",
        });
        continue;
      }
      if (rawRepository && !/\.mdx?$/.test(decoded)) continue;
      const target = resolve(checkout, decoded);
      const local = relative(resolve(checkout), target);
      if (
        local === ".." ||
        local.startsWith("../") ||
        local.startsWith("..\\") ||
        isAbsolute(local)
      ) {
        throw new Error(`URL escapes checkout: ${match[0]}`);
      }
      findings.push({ line: index + 1, url: match[0], repository, path: decoded, anchor, target });
    }
  }
  return findings;
}

export function auditLocalLinks(root, repositories) {
  const files = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8" },
  );
  return [...new Set(files.split("\0"))]
    .filter((file) => /\.mdx?$/.test(file) && !file.startsWith("notes/"))
    .flatMap((file) =>
      remoteLocalLinks(readFileSync(resolve(root, file), "utf8"), repositories).map((finding) => ({
        file,
        ...finding,
      })),
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  let root = process.cwd();
  const repositories = {};
  while (args.length) {
    const flag = args.shift();
    const value = args.shift();
    if (!value) throw new Error(`${flag} needs a value`);
    if (flag === "--root") root = resolve(value);
    else if (flag === "--repository" && value.includes("=")) {
      const index = value.indexOf("=");
      repositories[value.slice(0, index)] = resolve(value.slice(index + 1));
    } else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!Object.keys(repositories).length)
    throw new Error("Supply at least one --repository owner/name=checkout");
  console.log(JSON.stringify(auditLocalLinks(root, repositories), null, 2));
}
