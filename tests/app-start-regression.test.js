
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("Ansichtsstatus ist vor dem ersten Render initialisiert", async () => {
  const app = await readFile(new URL("js/app.js", root), "utf8");

  assert.match(app, /let currentView\s*=\s*["']all["'];/);
  assert.match(app, /let activePlaylistId\s*=\s*null;/);

  assert.ok(
    app.indexOf("let currentView") <
    app.indexOf("async function refreshSongs")
  );
});

test("Google Drive erhält einen definierten Song-Accessor", async () => {
  const app = await readFile(new URL("js/app.js", root), "utf8");

  assert.match(
    app,
    /async function getStoredSongs\(\)\s*\{[\s\S]*?return getSongs\(\);[\s\S]*?\}/
  );

  assert.match(app, /getStoredSongs\s*,/);
});

test("App- und Modul-Cache-Buster stehen auf Version 2.2.2", async () => {
  const [html, app, drive, worker] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("js/app.js", root), "utf8"),
    readFile(new URL("js/google-drive.js", root), "utf8"),
    readFile(new URL("sw.js", root), "utf8")
  ]);

  assert.match(html, /const appVersion = "2\.2\.2"/);
  assert.match(app, /google-drive\.js\?v=2\.2\.2/);
  assert.match(drive, /metadata\.js\?v=2\.2\.2/);
  assert.match(worker, /myspotify-v9/);
  assert.doesNotMatch(worker, /v=2\.2\.1/);
});

test("Bootstrap wartet auf vollständige App-Initialisierung", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("js/app.js", root), "utf8")
  ]);

  assert.match(app, /window\.MySpotifyAppReady\s*=\s*appReady/);

  assert.match(
    app,
    /appReady\s*=\s*initializeApp\(\)\.then\(\(\)\s*=>\s*\{\s*bindEvents\(\)/
  );

  assert.match(html, /await window\.MySpotifyAppReady/);
});
