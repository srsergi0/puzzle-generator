import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const entry = fileURLToPath(new URL("../src/client.ts", import.meta.url));
const htmlSrc = fileURLToPath(new URL("../public/index.html", import.meta.url));

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const result = await Bun.build({
  entrypoints: [entry],
  target: "browser",
  minify: true,
});
if (!result.success || !result.outputs[0]) {
  for (const log of result.logs) console.error(log.message);
  process.exit(1);
}
await writeFile(`${dist}app.js`, await result.outputs[0].text());

const html = (await readFile(htmlSrc, "utf8")).replace(
  /\s*<script>\s*new EventSource[\s\S]*?<\/script>/,
  "",
);
await writeFile(`${dist}index.html`, html);

console.log("dist/ listo: index.html + app.js");
