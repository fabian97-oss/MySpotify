import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {existsSync} from "node:fs";

const root = new URL("../", import.meta.url);
test("Bootstrap fängt ES-Modul-Importfehler ab und meldet sie sichtbar", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  assert.match(html, /await import\(`\.\/js\/app\.js\?v=\$\{appVersion\}`\)/);
  assert.match(html, /App-Modul konnte nicht geladen werden/);
  assert.match(html, /window\.MySpotifyBoot/);
});
test("Alle lokalen App-Module der Importkette existieren", () => {
  for (const file of ["js/app.js", "js/google-drive.js", "js/database.js", "js/metadata.js", "js/player.js"]) {
    assert.equal(existsSync(new URL(file, root)), true, `${file} fehlt`);
  }
});
