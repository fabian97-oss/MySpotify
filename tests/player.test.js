import test from "node:test";
import assert from "node:assert/strict";
import {MusicPlayer} from "../js/player.js";

function createPlayer() {
  const listeners = {};
  const audio = {
    paused: true,
    currentTime: 0,
    duration: 100,
    src: "",
    addEventListener(name, callback) { listeners[name] = callback; },
    async play() { this.paused = false; },
    pause() { this.paused = true; },
    removeAttribute() { this.src = ""; },
    load() {}
  };
  const songs = [1, 2, 3, 4].map(id => ({id, name: `Song ${id}`, url: `blob:${id}`}));
  const player = new MusicPlayer(audio, id => songs.find(song => song.id === id) || null);
  return {player, audio, songs, listeners};
}

test("Queue spielt in Playlist-Reihenfolge weiter und kann zurückspringen", async () => {
  const {player, songs} = createPlayer();
  await player.playSong(songs[1], songs.slice(0, 3));
  await player.next();
  assert.equal(player.currentSongId, 3);
  await player.previous();
  assert.equal(player.currentSongId, 2);
});

test("Shuffle behält den aktuellen Song an erster Stelle und erzeugt keine Duplikate", async () => {
  const {player, songs} = createPlayer();
  await player.playSong(songs[1], songs);
  player.toggleShuffle();
  assert.equal(player.queueIds[0], 2);
  assert.equal(new Set(player.queueIds).size, songs.length);
  assert.equal(player.queueIds.length, songs.length);
});

test("Wiederholung durchläuft Aus, ganze Queue und Einzeltitel", () => {
  const {player} = createPlayer();
  assert.equal(player.cycleRepeat(), "all");
  assert.equal(player.cycleRepeat(), "one");
  assert.equal(player.cycleRepeat(), "off");
});

test("Als-Nächstes fügt den Titel direkt hinter dem aktuellen Song ein", async () => {
  const {player, songs} = createPlayer();
  await player.playSong(songs[1], songs);
  player.toggleShuffle();
  assert.equal(player.enqueueNext({id: 5, name: "Song 5", url: "blob:5"}), true);
  assert.equal(player.queueIds[player.queueIndex + 1], 5);
  player.toggleShuffle();
  assert.equal(player.queueIds[player.queueIndex + 1], 5);
});

test("Warteschlange kann auch vor dem ersten Song befüllt und abgespielt werden", async () => {
  const {player, songs} = createPlayer();
  player.enqueueNext(songs[2]);
  player.enqueueNext(songs[0]);
  assert.deepEqual(player.getUpcomingSongs().map(song => song.id), [3, 1]);
  await player.togglePlay();
  assert.equal(player.currentSongId, 3);
});

test("Warteschlange lässt sich umsortieren und der aktuelle Song bleibt an Ort und Stelle", async () => {
  const {player, songs} = createPlayer();
  await player.playSong(songs[0], songs);
  player.moveQueuedSong(4, 1);
  assert.deepEqual(player.getUpcomingSongs().map(song => song.id), [2, 4, 3]);
  player.moveQueuedSong(2, 3);
  assert.deepEqual(player.getUpcomingSongs().map(song => song.id), [4, 3, 2]);
  assert.equal(player.currentSongId, 1);
});

test("Einzelne Queue-Einträge lassen sich entfernen, ohne sie aus der Bibliothek zu löschen", async () => {
  const {player, songs} = createPlayer();
  await player.playSong(songs[0], songs);
  assert.equal(player.removeQueuedSong(3), true);
  assert.deepEqual(player.getUpcomingSongs().map(song => song.id), [2, 4]);
  assert.equal(player.removeQueuedSong(1), false, "aktueller Song bleibt ausgewählt");
});


test("Playlist-Shuffle erzeugt eine echte Fisher-Yates-Permutation und startet den ersten Zufallstitel", async () => {
  const {player, songs} = createPlayer();
  const choices = [0, 0, 0];
  player.randomInt = maxExclusive => {
    const choice = choices.shift();
    assert.ok(choice >= 0 && choice < maxExclusive);
    return choice;
  };

  const order = await player.shufflePlaylist(songs);
  assert.deepEqual(order, [2, 3, 4, 1]);
  assert.deepEqual(player.sourceQueueIds, [1, 2, 3, 4], "ursprüngliche Playlist-Reihenfolge bleibt erhalten");
  assert.deepEqual(player.queueIds, [2, 3, 4, 1]);
  assert.equal(player.currentSongId, 2, "der erste zufällig gezogene Song startet sofort");
  assert.equal(player.shuffle, true);
  await player.next();
  assert.equal(player.currentSongId, 3, "Nächster Song folgt der gemischten Queue");
});

test("Fisher-Yates kann jede der 24 Permutationen von vier Songs genau einmal erzeugen", async () => {
  const {fisherYatesShuffle} = await import("../js/player.js");
  const permutations = new Set();

  for (let first = 0; first < 4; first += 1) {
    for (let second = 0; second < 3; second += 1) {
      for (let third = 0; third < 2; third += 1) {
        const choices = [first, second, third];
        const shuffled = fisherYatesShuffle([1, 2, 3, 4], maxExclusive => {
          const choice = choices.shift();
          assert.ok(choice >= 0 && choice < maxExclusive);
          return choice;
        });
        permutations.add(shuffled.join(","));
      }
    }
  }

  assert.equal(permutations.size, 24, "alle möglichen Reihenfolgen sind erreichbar");
});

test("Playlist-Shuffle ignoriert fehlende und doppelte Einträge und bricht bei leerer Liste ab", async () => {
  const {player, songs} = createPlayer();
  const result = await player.shufflePlaylist([songs[0], songs[0], null, {id: 99}]);
  assert.equal(result.length, 1);
  assert.deepEqual(new Set(result), new Set([1]));
  const empty = await player.shufflePlaylist([null, {id: 99}]);
  assert.equal(empty, false);
});
