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
