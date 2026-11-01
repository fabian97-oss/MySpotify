import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMetadata, mergeMetadata, migrateSongMetadata,
  setFavoriteState, setCoverState
} from "../js/metadata.js";

test("ältere Bibliotheksmetadaten werden in das neue Format übernommen", () => {
  const metadata = normalizeMetadata({
    favorites: ["drive-a"],
    playlists: [{id: "p1", name: "Mix", songIds: ["drive-a"]}],
    songCovers: {"drive-a": "data:image/jpeg;base64,abc"}
  });
  assert.equal(metadata.version, 2);
  assert.deepEqual(metadata.favorites, ["drive-a"]);
  assert.equal(metadata.playlists[0].songIds[0], "drive-a");
  assert.equal(metadata.songCovers["drive-a"], "data:image/jpeg;base64,abc");
});

test("neuere Favoritenänderungen überschreiben ältere Zustände", () => {
  const older = normalizeMetadata({favoriteStates: {
    "drive-a": {value: true, updatedAt: 10, deviceId: "device-a"}
  }});
  const newer = normalizeMetadata({favoriteStates: {
    "drive-a": {value: false, updatedAt: 20, deviceId: "device-b"}
  }});
  const merged = mergeMetadata(older, newer);
  assert.deepEqual(merged.favorites, []);
  assert.equal(merged.favoriteStates["drive-a"].value, false);
});

test("Playlist-Löschmarkierungen verhindern das Wiederauftauchen alter Playlists", () => {
  const playlist = {playlists: [{id: "p1", name: "Mix", songIds: [], updatedAt: 100, deviceId: "a"}]};
  const deleted = {deletedPlaylistIds: {p1: {deletedAt: 200, deviceId: "b"}}};
  assert.equal(mergeMetadata(playlist, deleted).playlists.length, 0);
});

test("Song-ID-Migration erhält Favoriten, Cover und Playlist-Zuordnung", () => {
  let metadata = normalizeMetadata({
    favorites: ["local-8"],
    playlists: [{id: "p1", name: "Mix", songIds: ["local-8"]}],
    songCovers: {"local-8": "data:image/jpeg;base64,abc"}
  });
  metadata = migrateSongMetadata(metadata, "local-8", "drive-8", "device-a");
  assert.deepEqual(metadata.favorites, ["drive-8"]);
  assert.deepEqual(metadata.playlists[0].songIds, ["drive-8"]);
  assert.equal(metadata.songCovers["drive-8"], "data:image/jpeg;base64,abc");
});

test("Favoriten und Cover können auch als Änderung auf 'aus/leer' synchronisiert werden", () => {
  let metadata = normalizeMetadata({favorites: ["drive-a"], songCovers: {"drive-a": "data:image/jpeg;base64,abc"}});
  metadata = setFavoriteState(metadata, "drive-a", false, "device-a");
  metadata = setCoverState(metadata, "drive-a", null, "device-a");
  assert.deepEqual(metadata.favorites, []);
  assert.equal(metadata.songCovers["drive-a"], undefined);
  assert.equal(metadata.coverStates["drive-a"].value, null);
});
