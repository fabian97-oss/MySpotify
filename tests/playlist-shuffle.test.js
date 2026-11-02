import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("Shuffle-Schaltfläche ist nur in den Playlist-Detailaktionen enthalten", async () => {
  const html = await read("index.html");
  const actions = html.slice(html.indexOf('id="playlist-detail-actions"'), html.indexOf('</div>', html.indexOf('id="playlist-detail-actions"')));
  assert.match(actions, /id="playlist-shuffle-button"/);
  assert.match(actions, /Playlist mischen/);
});

test("Shuffle-Aktion nimmt die Song-IDs in der gespeicherten Playlist-Reihenfolge", async () => {
  const app = await read("js/app.js");
  const shuffle = app.slice(app.indexOf("async function shuffleActivePlaylist"), app.indexOf("async function deleteActivePlaylist"));
  assert.match(shuffle, /const songsByKey = new Map\(songs\.map\(song => \[songKey\(song\), song\]\)\)/);
  assert.match(shuffle, /playlist\.songIds\.map\(key => songsByKey\.get\(key\)\)\.filter\(Boolean\)/);
  assert.match(shuffle, /player\.shufflePlaylist\(playlistSongs\)/);
});

test("Playlist-Shuffle-Button ist korrekt gebunden und bei leerer Playlist deaktiviert", async () => {
  const app = await read("js/app.js");
  assert.match(app, /byId\("playlist-shuffle-button"\)\.addEventListener\("click", shuffleActivePlaylist\)/);
  assert.match(app, /playlistShuffleButton\.disabled = playableCount === 0/);
});

test("Shuffle nutzt Fisher-Yates mit Web Crypto statt zufälliger Array-Sortierung", async () => {
  const player = await read("js/player.js");
  assert.match(player, /cryptoApi\.getRandomValues\(buffer\)/);
  assert.match(player, /export function fisherYatesShuffle\(items, randomInt = secureRandomInt\)/);
  assert.match(player, /for \(let index = result\.length - 1; index > 0; index -= 1\)/);
  assert.doesNotMatch(player, /\.sort\(\s*\(\s*\)\s*=>\s*Math\.random/);
});
