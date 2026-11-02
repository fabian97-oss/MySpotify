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

test("Start zeigt Playlist-Kacheln zuerst und Songs hinzufügen am Seitenende", async () => {
  const [app, html] = await Promise.all([read("js/app.js"), read("index.html")]);
  assert.match(app, /let activeSection = "home"/);
  assert.match(app, /const songsVisible = search \|\| playlistDetailOpen/);
  assert.match(app, /byId\("songs-section"\)\.hidden = !songsVisible/);
  assert.match(app, /byId\("welcome-section"\)\.hidden = home/);
  assert.match(app, /byId\("home-actions-section"\)\.hidden = !home/);
  assert.ok(html.indexOf('id="playlist-section"') < html.indexOf('id="home-actions-section"'));
  assert.ok(html.indexOf('id="playlist-section"') < html.indexOf('id="music-upload"'));
  assert.match(html, /id="nav-home"/);
  assert.match(html, /id="nav-search"/);
  assert.match(html, /id="nav-library"/);
});

test("Playlist-Erstellung ist in der Mediathek und nicht im Start-Header", async () => {
  const [app, html] = await Promise.all([read("js/app.js"), read("index.html")]);
  assert.match(html, /id="create-playlist-button"[^>]+hidden/);
  assert.match(app, /byId\("create-playlist-button"\)\.hidden = !library/);
});

test("Erster App-Start fragt nach Google Drive oder lokalem Modus", async () => {
  const [app, html] = await Promise.all([read("js/app.js"), read("index.html")]);
  assert.match(html, /id="drive-choice-dialog"/);
  assert.match(html, /id="drive-choice-connect"/);
  assert.match(html, /id="drive-choice-local"/);
  assert.match(app, /const DRIVE_CHOICE_KEY = "myspotify-drive-choice-v1"/);
  assert.match(app, /if \(!choice && dialog && !dialog\.open\) dialog\.showModal\(\)/);
  assert.match(app, /saveDriveChoice\("local"\)/);
});

test("Nach erfolgreicher Google-Verbindung wird der Textbutton durch das Sync-Symbol ersetzt", async () => {
  const [app, drive, html] = await Promise.all([read("js/app.js"), read("js/google-drive.js"), read("index.html")]);
  assert.match(html, /id="google-connect-button"[^>]+hidden/);
  assert.match(html, /id="drive-sync-button"[^>]+hidden/);
  assert.match(drive, /myspotify-drive-connected/);
  assert.match(app, /window\.addEventListener\("myspotify-drive-connected"/);
  assert.match(app, /updateDriveControls\("connected"\)/);
});


test("Playlist-Cover und Name öffnen dieselbe Playlist über eine große Kachel-Schaltfläche", async () => {
  const app = await read("js/app.js");
  const createCard = app.slice(app.indexOf("function createPlaylistCard"), app.indexOf("function renderPlaylists"));
  assert.match(createCard, /openButton\.className = "playlist-card-open"/);
  assert.match(createCard, /artwork\.appendChild\(image\)/);
  assert.match(createCard, /details\.append\(title, songCount\)/);
  assert.match(createCard, /openButton\.append\(artwork, details\)/);
  assert.match(createCard, /openButton\.addEventListener\("click"[\s\S]*?openPlaylist\(id\)/);
});

test("Playlist-Kacheln enthalten keine Verwaltungsaktionen mehr", async () => {
  const app = await read("js/app.js");
  const render = app.slice(app.indexOf("function renderPlaylists"), app.indexOf("async function renameActivePlaylist"));
  assert.doesNotMatch(render, /Umbenennen|Cover ändern|Playlist löschen|makeButton\(/);
  assert.match(render, /createPlaylistCard\(/);
});

test("Umbenennen, Cover ändern und Löschen sind nur in der Playlist-Detailansicht erreichbar", async () => {
  const [app, html] = await Promise.all([read("js/app.js"), read("index.html")]);
  assert.match(html, /id="playlist-detail-actions"[^>]+hidden/);
  assert.match(html, /id="playlist-rename-button"/);
  assert.match(html, /id="playlist-cover-button"/);
  assert.match(html, /id="playlist-delete-button"/);
  assert.match(app, /byId\("playlist-detail-actions"\)\.hidden = !library \|\| !activePlaylist/);
  assert.match(app, /byId\("playlist-rename-button"\)\.addEventListener\("click", renameActivePlaylist\)/);
  assert.match(app, /byId\("playlist-cover-button"\)\.addEventListener\("click", changeActivePlaylistCover\)/);
  assert.match(app, /byId\("playlist-delete-button"\)\.addEventListener\("click", deleteActivePlaylist\)/);
});

test("Playlist-Detailansicht hat Zurück-Navigation und blendet das Kachel-Grid aus", async () => {
  const [app, html] = await Promise.all([read("js/app.js"), read("index.html")]);
  assert.match(html, /id="playlist-back-button"[^>]+hidden/);
  assert.match(app, /function closePlaylistDetail\(\)/);
  assert.match(app, /byId\("playlist-back-button"\)\.addEventListener\("click", closePlaylistDetail\)/);
  assert.match(app, /playlistList\.hidden = playlistDetailOpen/);
  assert.match(app, /activeSection = "library";[\s\S]*?renderAll\(\)/);
});

test("Playlist-Übersicht wird als responsives Grid dargestellt", async () => {
  const css = await read("style.css");
  assert.match(css, /\.playlist-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fill, minmax\(160px, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.playlist-grid\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});
