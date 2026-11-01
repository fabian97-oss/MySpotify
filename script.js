/* MySpotify – lokale Musik, Playlists, Cover, Favoriten und Cloud-Metadaten */
"use strict";

const audio = document.getElementById("audio-player");
const upload = document.getElementById("music-upload");
const songList = document.getElementById("song-list");
const playlistList = document.getElementById("playlist-list");
const statusText = document.getElementById("upload-status");
const searchInput = document.getElementById("search-input");

let database;
let songs = [];
let metadata = {version: 1, favorites: [], playlists: [], songCovers: {}, deletedSongIds: []};
let currentSongIndex = -1;
let currentView = "all";
let activePlaylistId = null;
let objectUrls = [];

const byId = id => document.getElementById(id);
const makeId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("MySpotifyDatabase", 2);
    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("songs")) db.createObjectStore("songs", {keyPath: "id", autoIncrement: true});
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", {keyPath: "key"});
    };
    request.onsuccess = () => { database = request.result; resolve(database); };
    request.onerror = () => reject(request.error);
  });
}

function dbRequest(storeName, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction([storeName], mode);
    const request = action(tx.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
const getSongs = () => dbRequest("songs", "readonly", store => store.getAll());
const addSong = song => dbRequest("songs", "readwrite", store => store.add(song));
const putSong = song => dbRequest("songs", "readwrite", store => store.put(song));
const removeSong = id => dbRequest("songs", "readwrite", store => store.delete(id));

async function loadMetadata() {
  const record = await dbRequest("settings", "readonly", store => store.get("library"));
  if (record && record.value) metadata = normalizeMetadata(record.value);
}
function normalizeMetadata(value) {
  return {
    version: 1,
    favorites: Array.isArray(value.favorites) ? value.favorites : [],
    playlists: Array.isArray(value.playlists) ? value.playlists : [],
    songCovers: value.songCovers && typeof value.songCovers === "object" ? value.songCovers : {},
    deletedSongIds: Array.isArray(value.deletedSongIds) ? value.deletedSongIds : []
  };
}
async function saveMetadata(sync = true) {
  metadata.version = 1;
  await dbRequest("settings", "readwrite", store => store.put({key: "library", value: metadata}));
  if (sync && window.MySpotifyDrive?.isConnected()) {
    try { await window.MySpotifyDrive.saveMetadata(metadata); }
    catch (error) { console.error(error); statusText.textContent = `Metadaten konnten nicht synchronisiert werden: ${error.message}`; }
  }
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
function makeImageElement(src, className, alt = "") {
  if (!src) return null;
  const img = document.createElement("img");
  img.src = src; img.className = className; img.alt = alt;
  return img;
}
async function imageToDataUrl(file) {
  if (!file || !file.type.startsWith("image/")) throw new Error("Bitte wähle eine Bilddatei aus.");
  if (file.size > 12 * 1024 * 1024) throw new Error("Das Bild ist zu groß (maximal 12 MB).");
  const source = await createImageBitmap(file);
  const scale = Math.min(1, 600 / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close?.();
  return canvas.toDataURL("image/jpeg", 0.78);
}
function songKey(song) { return song.driveFileId || `local-${song.id}`; }
function isFavorite(song) { return metadata.favorites.includes(songKey(song)); }

async function migrateLocalMetadata(song, driveFileId) {
  const oldKey = `local-${song.id}`;
  if (metadata.favorites.includes(oldKey)) {
    metadata.favorites = metadata.favorites.filter(key => key !== oldKey);
    metadata.favorites.push(driveFileId);
  }
  if (metadata.songCovers[oldKey]) {
    metadata.songCovers[driveFileId] = metadata.songCovers[oldKey];
    delete metadata.songCovers[oldKey];
  }
  metadata.playlists.forEach(playlist => {
    playlist.songIds = (playlist.songIds || []).map(id => id === oldKey ? driveFileId : id);
  });
  await saveMetadata();
}

async function refreshSongs() {
  const stored = await getSongs();
  objectUrls.forEach(url => URL.revokeObjectURL(url));
  objectUrls = [];
  songs = stored.filter(song => song.file).map(song => {
    const url = URL.createObjectURL(song.file); objectUrls.push(url);
    return {...song, url};
  });
  if (currentSongIndex >= songs.length) currentSongIndex = -1;
  renderAll();
}
function currentSongs() {
  let list = [...songs];
  if (currentView === "favorites") list = list.filter(isFavorite);
  if (activePlaylistId) {
    const playlist = metadata.playlists.find(item => item.id === activePlaylistId);
    const ids = new Set(playlist?.songIds || []);
    list = list.filter(song => ids.has(songKey(song)));
  }
  const query = searchInput.value.trim().toLocaleLowerCase("de");
  if (query) list = list.filter(song => song.name.toLocaleLowerCase("de").includes(query));
  return list;
}
function renderPlaylists() {
  playlistList.innerHTML = "";
  const favoritesCard = document.createElement("div");
  favoritesCard.className = `playlist-card ${currentView === "favorites" ? "selected" : ""}`;
  favoritesCard.innerHTML = `<div class="playlist-placeholder">♥</div><div class="playlist-details"><strong>Meine Favoriten</strong><div class="playlist-actions"><button class="small-button" type="button">Öffnen</button></div></div>`;
  favoritesCard.querySelector("button").addEventListener("click", () => {
    currentView = currentView === "favorites" ? "all" : "favorites";
    activePlaylistId = null; renderAll();
  });
  playlistList.appendChild(favoritesCard);

  metadata.playlists.forEach(playlist => {
    const card = document.createElement("article");
    card.className = `playlist-card ${activePlaylistId === playlist.id ? "selected" : ""}`;
    const cover = playlist.cover ? makeImageElement(playlist.cover, "", playlist.name) : null;
    if (cover) card.appendChild(cover);
    else { const placeholder = document.createElement("div"); placeholder.className = "playlist-placeholder"; placeholder.textContent = "♫"; card.appendChild(placeholder); }
    const details = document.createElement("div"); details.className = "playlist-details";
    const title = document.createElement("strong"); title.textContent = playlist.name;
    const actions = document.createElement("div"); actions.className = "playlist-actions";
    const open = document.createElement("button"); open.className = "small-button"; open.textContent = "Öffnen";
    open.onclick = () => { activePlaylistId = activePlaylistId === playlist.id ? null : playlist.id; currentView = "all"; renderAll(); };
    const rename = document.createElement("button"); rename.className = "small-button"; rename.textContent = "Umbenennen";
    rename.onclick = async () => { const name = prompt("Neuer Playlistname:", playlist.name); if (name && name.trim()) { playlist.name = name.trim(); await saveMetadata(); renderAll(); } };
    const coverBtn = document.createElement("button"); coverBtn.className = "small-button"; coverBtn.textContent = "Cover";
    coverBtn.onclick = () => chooseImage(async data => { playlist.cover = data; await saveMetadata(); renderAll(); });
    const del = document.createElement("button"); del.className = "small-button"; del.textContent = "Löschen";
    del.onclick = async () => { if (confirm(`Playlist „${playlist.name}“ wirklich löschen? Die Songs bleiben erhalten.`)) { metadata.playlists = metadata.playlists.filter(p => p.id !== playlist.id); if (activePlaylistId === playlist.id) activePlaylistId = null; await saveMetadata(); renderAll(); } };
    actions.append(open, rename, coverBtn, del); details.append(title, actions); card.appendChild(details); playlistList.appendChild(card);
  });
}
function renderSongs() {
  songList.innerHTML = "";
  const list = currentSongs();
  if (!list.length) {
    const empty = document.createElement("div"); empty.className = "empty-music";
    empty.innerHTML = "<span>🎶</span><h3>Keine passenden Songs</h3><p>Füge Musik hinzu oder ändere deine Suche.</p>";
    songList.appendChild(empty); return;
  }
  list.forEach(song => {
    const index = songs.findIndex(item => item.id === song.id);
    const item = document.createElement("div"); item.className = `song-item ${index === currentSongIndex ? "active" : ""}`;
    const coverData = metadata.songCovers[songKey(song)];
    const cover = coverData ? makeImageElement(coverData, "song-cover", "") : null;
    if (cover) item.appendChild(cover);
    else { const placeholder = document.createElement("div"); placeholder.className = "song-placeholder"; placeholder.textContent = "♫"; item.appendChild(placeholder); }
    const info = document.createElement("div"); info.className = "song-item-info";
    const name = document.createElement("strong"); name.textContent = song.name;
    const sub = document.createElement("span"); sub.textContent = song.driveFileId ? "Eigene Musik · Cloud-Synchronisiert" : "Eigene Musik · Nur auf diesem Gerät";
    info.append(name, sub); info.onclick = () => playSong(index);
    const actions = document.createElement("div"); actions.className = "song-actions";
    const fav = document.createElement("button"); fav.className = isFavorite(song) ? "favorite" : ""; fav.textContent = isFavorite(song) ? "♥" : "♡"; fav.title = "Favorit";
    fav.onclick = async () => { const key = songKey(song); metadata.favorites = isFavorite(song) ? metadata.favorites.filter(x => x !== key) : [...metadata.favorites, key]; await saveMetadata(); renderAll(); };
    const coverBtn = document.createElement("button"); coverBtn.textContent = "Bild"; coverBtn.title = "Coverbild hinzufügen";
    coverBtn.onclick = () => chooseImage(async data => { metadata.songCovers[songKey(song)] = data; await saveMetadata(); renderAll(); });
    const add = document.createElement("button"); add.textContent = "+ Liste"; add.title = "Zu Playlist hinzufügen";
    add.onclick = async () => { if (!metadata.playlists.length) { alert("Erstelle zuerst eine Playlist."); return; } const choice = prompt(`Playlist auswählen:\n${metadata.playlists.map((p,i)=>`${i+1}: ${p.name}`).join("\n")}\n\nNummer eingeben:`); const p = metadata.playlists[Number(choice)-1]; if (!p) return; p.songIds = p.songIds || []; if (!p.songIds.includes(songKey(song))) p.songIds.push(songKey(song)); await saveMetadata(); statusText.textContent = `„${song.name}“ wurde zu „${p.name}“ hinzugefügt.`; };
    const del = document.createElement("button"); del.textContent = "Löschen"; del.title = "Song endgültig löschen";
    del.onclick = () => deleteSong(song);
    actions.append(fav, coverBtn, add, del); item.append(info, actions); songList.appendChild(item);
  });
}
function renderAll() {
  renderPlaylists(); renderSongs();
  const title = byId("section-title");
  title.textContent = activePlaylistId ? (metadata.playlists.find(p => p.id === activePlaylistId)?.name || "Playlist") : currentView === "favorites" ? "Meine Favoriten" : "Deine Musik";
}
async function playSong(index) {
  if (index < 0 || index >= songs.length) return;
  currentSongIndex = index;
  const song = songs[index];
  audio.src = song.url;
  byId("current-title").textContent = song.name;
  byId("current-artist").textContent = "Eigene Musik";
  const cover = metadata.songCovers[songKey(song)];
  byId("player-cover").hidden = !cover;
  byId("player-cover-placeholder").hidden = Boolean(cover);
  if (cover) byId("player-cover").src = cover;
  renderSongs();
  try { await audio.play(); byId("play-btn").textContent = "Ⅱ"; }
  catch (error) { console.error("Wiedergabe fehlgeschlagen:", error); byId("play-btn").textContent = "▶"; }
}
async function deleteSong(song) {
  const key = songKey(song);
  const cloudText = song.driveFileId ? "Der Song wird endgültig aus Google Drive gelöscht und auf allen verbundenen Geräten entfernt." : "Der Song wird von diesem Gerät gelöscht.";
  if (!confirm(`„${song.name}“ wirklich löschen?\n\n${cloudText}\n\nDieser Vorgang kann nicht rückgängig gemacht werden.`)) return;
  try {
    if (song.driveFileId) {
      metadata.deletedSongIds = [...new Set([...metadata.deletedSongIds, song.driveFileId])];
      await saveMetadata(false);
      if (window.MySpotifyDrive?.isConnected()) await window.MySpotifyDrive.deleteDriveFile(song.driveFileId);
    }
    metadata.favorites = metadata.favorites.filter(id => id !== key);
    delete metadata.songCovers[key];
    metadata.playlists.forEach(p => p.songIds = (p.songIds || []).filter(id => id !== key));
    await removeSong(song.id);
    if (currentSongIndex >= 0 && songs[currentSongIndex]?.id === song.id) {
      audio.pause(); audio.removeAttribute("src"); audio.load(); currentSongIndex = -1;
      byId("current-title").textContent = "Kein Song ausgewählt";
      byId("current-artist").textContent = "MySpotify";
    }
    await saveMetadata();
    await refreshSongs();
    statusText.textContent = song.driveFileId ? "Song endgültig gelöscht." : "Song lokal gelöscht.";
  } catch (error) {
    console.error(error);
    statusText.textContent = `Löschen fehlgeschlagen: ${error.message}`;
    alert(`Der Song konnte nicht vollständig gelöscht werden: ${error.message}`);
  }
}
function chooseImage(callback) {
  const input = document.createElement("input"); input.type = "file"; input.accept = "image/*";
  input.onchange = async () => {
    const file = input.files && input.files[0]; if (!file) return;
    try { callback(await imageToDataUrl(file)); } catch (error) { alert(error.message); }
  };
  input.click();
}
async function syncOnConnect() {
  if (!database || !window.MySpotifyDrive?.isConnected()) return;
  await window.MySpotifyDrive.synchronizeSongs();
}

upload.addEventListener("change", async event => {
  const files = Array.from(event.target.files || []);
  let count = 0;
  for (const file of files) {
    if (!(file.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name))) continue;
    try { await addSong({name: file.name.replace(/\.[^/.]+$/, ""), file, addedAt: Date.now()}); count++; }
    catch (error) { console.error(error); }
  }
  upload.value = "";
  await refreshSongs();
  statusText.textContent = count ? `${count} Song(s) lokal gespeichert.` : "Keine Audiodateien ausgewählt.";
  if (count && window.MySpotifyDrive?.isConnected()) await window.MySpotifyDrive.synchronizeSongs();
});
byId("create-playlist-button").addEventListener("click", async () => {
  const name = prompt("Wie soll deine neue Playlist heißen?");
  if (!name || !name.trim()) return;
  metadata.playlists.push({id: makeId(), name: name.trim(), songIds: [], cover: null});
  await saveMetadata(); renderAll();
});
byId("show-all-button").addEventListener("click", () => { currentView = "all"; activePlaylistId = null; renderAll(); byId("show-all-button").classList.add("active"); byId("show-favorites-button").classList.remove("active"); });
byId("show-favorites-button").addEventListener("click", () => { currentView = "favorites"; activePlaylistId = null; renderAll(); byId("show-favorites-button").classList.add("active"); byId("show-all-button").classList.remove("active"); });
searchInput.addEventListener("input", renderSongs);
byId("nav-home").onclick = () => { currentView = "all"; activePlaylistId = null; searchInput.value = ""; renderAll(); };
byId("nav-search").onclick = () => searchInput.focus();
byId("nav-library").onclick = () => { currentView = "all"; activePlaylistId = null; renderAll(); };
byId("play-btn").addEventListener("click", async () => {
  if (currentSongIndex < 0) { if (songs.length) await playSong(0); return; }
  if (audio.paused) { try { await audio.play(); byId("play-btn").textContent = "Ⅱ"; } catch (error) { console.error(error); } }
  else { audio.pause(); byId("play-btn").textContent = "▶"; }
});
byId("previous-btn").onclick = () => { if (!songs.length) return; if (audio.currentTime > 3) audio.currentTime = 0; else playSong((currentSongIndex - 1 + songs.length) % songs.length); };
byId("next-btn").onclick = () => { if (songs.length) playSong((currentSongIndex + 1) % songs.length); };
audio.addEventListener("ended", () => { if (songs.length > 1) playSong((currentSongIndex + 1) % songs.length); else byId("play-btn").textContent = "▶"; });
audio.addEventListener("play", () => byId("play-btn").textContent = "Ⅱ");
audio.addEventListener("pause", () => byId("play-btn").textContent = "▶");
audio.addEventListener("timeupdate", () => { if (Number.isFinite(audio.duration)) { byId("progress").value = audio.currentTime / audio.duration * 100; byId("current-time").textContent = formatTime(audio.currentTime); } });
audio.addEventListener("loadedmetadata", () => { byId("duration").textContent = formatTime(audio.duration); byId("current-time").textContent = "0:00"; byId("progress").value = 0; });
byId("progress").addEventListener("input", () => { if (Number.isFinite(audio.duration)) audio.currentTime = Number(byId("progress").value) / 100 * audio.duration; });
byId("volume").addEventListener("input", () => audio.volume = Number(byId("volume").value));
audio.volume = 0.7;

window.MySpotifyMusic = {
  getStoredSongs: () => getSongs(),
  setDriveFileId: async (songId, driveFileId) => {
    const list = await getSongs(); const song = list.find(item => item.id === songId);
    if (!song) throw new Error("Lokaler Song wurde nicht gefunden.");
    await migrateLocalMetadata(song, driveFileId);
    song.driveFileId = driveFileId; await putSong(song);
  },
  saveDownloadedSong: song => addSong(song),
  deleteLocalSong: id => removeSong(id),
  getMetadata: async () => { await loadMetadata(); return metadata; },
  setMetadata: async (value, sync = false) => { metadata = normalizeMetadata(value); await saveMetadata(sync); renderAll(); },
  refresh: refreshSongs
};

window.addEventListener("myspotify-drive-connected", syncOnConnect);
async function initializeApp() {
  try {
    statusText.textContent = "Gespeicherte Musik wird geladen …";
    await openDatabase(); await loadMetadata(); await refreshSongs();
    statusText.textContent = `${songs.length} gespeicherte Songs geladen.`;
  } catch (error) {
    console.error("Startfehler:", error); statusText.textContent = `App konnte nicht gestartet werden: ${error.message}`;
  }
}
initializeApp();
window.addEventListener("beforeunload", () => objectUrls.forEach(url => URL.revokeObjectURL(url)));
