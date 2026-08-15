import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A structural rule that neither the type system nor a runtime assertion can
 * express: *every* editor in this app must take its extensions from
 * `createEditorExtensions`.
 *
 * It matters because the failure it prevents is silent and destructive. Which
 * extensions an editor carries decides which Markdown it can hold, while the
 * tokenizers that decide how Markdown is *read* are registered process-wide. An
 * editor assembled from its own list therefore does not merely render less — it
 * parses syntax it cannot store and drops it, deleting text on the next save.
 * That has now happened three times here: in documents, in comments, and in
 * task descriptions.
 *
 * Nothing in a type signature catches a hand-written array, so the check reads
 * the source. If a new editor appears, this fails and names the file.
 */
const SRC = resolve(import.meta.dirname, "..");

function sourceFiles(directory = SRC): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    if (entry.name === "routeTree.gen.ts") return [];
    return [path];
  });
}

/** Files that construct a Tiptap editor, by the two APIs that can do it. */
function editorCallSites() {
  return sourceFiles()
    .map((path) => ({ path, source: readFileSync(path, "utf8") }))
    .filter(({ source }) => /\buseEditor\s*\(|\bnew Editor\s*\(/.test(source));
}

describe("every editor is built from the shared extension set", () => {
  it("finds the editors it is supposed to be guarding", () => {
    // A rule that matches nothing passes for the wrong reason. If this drops to
    // zero the glob or the pattern broke, not the codebase.
    expect(editorCallSites().length).toBeGreaterThan(0);
  });

  it("gives each of them its extensions from createEditorExtensions", () => {
    const offenders = editorCallSites()
      .filter(({ source }) => !source.includes("createEditorExtensions"))
      .map(({ path }) => path.replace(SRC, ""));

    expect(
      offenders,
      [
        "These files construct an editor without taking their extensions from",
        "`createEditorExtensions`. A hand-written list parses Markdown it cannot",
        "store and deletes it on save — see this file's comment.",
      ].join(" "),
    ).toEqual([]);
  });
});
