// Feeds transcript files from disk into the same accumulator the page uses.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { ingestLine, projectFromPath } from "../js/parse.js";

export async function readTranscripts(files, acc) {
  for (const file of files) {
    acc.files++;
    const fallback = projectFromPath(file.path);
    const lines = createInterface({ input: createReadStream(file.abs), crlfDelay: Infinity });
    for await (const line of lines) ingestLine(acc, line, fallback);
  }
  return acc;
}
