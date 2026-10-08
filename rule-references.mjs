// Plan reference writes before changing output; retain owned older files, never delete them.
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const hash = (text) => createHash("sha256").update(text).digest("hex");
const safeName = (name) => /^[a-z0-9][a-z0-9-]*\.md$/.test(name);

export function checkOutputPath(path, directory = false) {
  path = resolve(path);
  for (let current = path; ; current = dirname(current)) {
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (stat) {
      if (
        stat.isSymbolicLink() ||
        (current === path && !directory ? !stat.isFile() : !stat.isDirectory())
      )
        throw new Error(`Unsafe output path: ${current}`);
    }
    if (dirname(current) === current) break;
  }
}

export function planReferenceOutput(directory, references) {
  checkOutputPath(directory, true);
  const manifestPath = join(directory, "manifest.json");
  let files = {};
  if (existsSync(directory) && readdirSync(directory).length) {
    if (!existsSync(manifestPath) || !lstatSync(manifestPath).isFile())
      throw new Error(`Unmanaged reference directory: ${directory}`);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (
      manifest.format !== 1 ||
      !manifest.files ||
      typeof manifest.files !== "object" ||
      Array.isArray(manifest.files)
    )
      throw new Error(`Invalid reference manifest: ${manifestPath}`);
    files = manifest.files;
    for (const [name, sha] of Object.entries(files)) {
      if (!safeName(name) || typeof sha !== "string" || !/^[a-f0-9]{64}$/.test(sha))
        throw new Error(`Invalid reference manifest: ${manifestPath}`);
      const path = join(directory, name);
      if (!existsSync(path) || !lstatSync(path).isFile() || hash(readFileSync(path)) !== sha)
        throw new Error(`Modified or missing reference; reconcile it first: ${path}`);
    }
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (
        lstatSync(path).isSymbolicLink() ||
        (name !== "manifest.json" && !Object.hasOwn(files, name))
      )
        throw new Error(`Unrecognized reference file; reconcile it first: ${path}`);
    }
  }
  const writes = [];
  for (const [name, text] of references) {
    if (!safeName(name) || typeof text !== "string") throw new Error("Invalid reference output");
    if (files[name] !== hash(text)) writes.push({ path: join(directory, name), text });
    files[name] = hash(text);
  }
  const text = JSON.stringify({ format: 1, files }, null, 2) + "\n";
  if (!existsSync(manifestPath) || readFileSync(manifestPath, "utf8") !== text)
    writes.push({ path: manifestPath, text });
  return writes;
}

export function writeReferenceOutput(writes) {
  for (const { path, text } of writes) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
}
