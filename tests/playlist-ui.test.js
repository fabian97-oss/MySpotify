import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

test("Playlist-Auswahl nutzt ein echtes Kachel-Dialogfenster statt Nummern-Prompt", async () => {
  const [html, app, css] = await Promise.all([
    read("index.html"), read("js/app.js"), read("style.css")
  ]);
  assert.match(html, /<dialog[^>]+id="playlist-picker-dialog"/);
  assert.match(html, /id="playlist-picker-grid"/);
  assert.match(app, /function openPlaylistPicker\(song\)/);
  assert.match(app, /makeButton\("\+ Liste"[^\n]*openPlaylistPicker\(song\)/);
  assert.doesNotMatch(app, /Playlist auswählen:[\s\S]{0,250}Nummer eingeben/);
  assert.match(css, /\.playlist-picker-tile\[aria-pressed="true"\] \.playlist-picker-cover/);
});

test("Bereits zugeordnete Playlists sind im Dialog vorausgewählt", async () => {
  const app = await read("js/app.js");
  assert.match(app, /selectedPlaylistIds = new Set\(metadata\.playlists[\s\S]*?playlist\.songIds\.includes\(key\)/);
  assert.match(app, /tile\.setAttribute\("aria-pressed", String\(selected\)\)/);
  assert.match(app, /if \(selectedPlaylistIds\.has\(playlist\.id\)\) selectedPlaylistIds\.delete\(playlist\.id\)/);
});

test("Bestätigen übernimmt Mehrfachauswahl und speichert Playlist-Metadaten", async () => {
  const app = await read("js/app.js");
  assert.match(app, /async function savePlaylistPickerSelection\(\)/);
  assert.match(app, /const shouldHaveSong = selectedPlaylistIds\.has\(playlist\.id\)/);
  assert.match(app, /playlist\.songIds = shouldHaveSong[\s\S]*?filter\(id => id !== key\)/);
  assert.match(app, /await persistMetadata\(\)/);
});

test("Song aus geöffneter Playlist entfernen löscht ihn nicht aus der Bibliothek", async () => {
  const app = await read("js/app.js");
  assert.match(app, /async function removeSongFromActivePlaylist\(song\)/);
  assert.match(app, /playlist\.songIds = playlist\.songIds\.filter\(id => id !== key\)/);
  assert.match(app, /Der Song bleibt in deiner Bibliothek erhalten/);
  const removeFunction = app.slice(app.indexOf("async function removeSongFromActivePlaylist"), app.indexOf("function renderSongs"));
  assert.doesNotMatch(removeFunction, /removeSong\(|deleteSong\(/);
  assert.match(app, /Aus Playlist entfernen/);
});

test("Start blendet die vollständige Songliste aus; Suche zeigt sie", async () => {
  const [app, html] = await Promise.all([read("js/app.js"), read("index.html")]);
  assert.match(app, /let activeSection = "home"/);
  assert.match(app, /const songsVisible = activeSection === "search" \|\| Boolean\(activePlaylistId\) \|\| currentView === "favorites"/);
  assert.match(app, /songsSection\.hidden = !songsVisible/);
  assert.match(app, /activeSection = "search";[\s\S]{0,100}renderAll\(\);[\s\S]{0,80}searchInput\.focus\(\)/);
  assert.match(html, /id="nav-home"/);
  assert.match(html, /id="nav-search"/);
  assert.match(html, /id="nav-library"/);
});
