import {
  openDatabase, dbRequest, getSongs, addSong, putSong, removeSong,
  getOrCreateDeviceId
} from "./database.js?v=2.2.0";
import {
  normalizeMetadata, mergeMetadata, migrateSongMetadata,
  setFavoriteState, setCoverState
} from "./metadata.js?v=2.2.0";
import {MusicPlayer} from "./player.js?v=2.2.0";
import {createGoogleDrive} from "./google-drive.js?v=2.2.0";

const audio = document.getElementById("audio-player");
const uploadInput = document.getElementById("music-upload");
const songList = document.getElementById("song-list");
const playlistList = document.getElementById("playlist-list");
const queueList = document.getElementById("queue-list");
const statusText = document.getElementById("upload-status");
const searchInput = document.getElementById("search-input");
const sortSelect = document.getElementById("sort-select");
const byId = id => document.getElementById(id);
const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const isAudioFile = file => Boolean(file?.type?.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac|opus|aiff|wma)$/i.test(file?.name || ""));

let metadata = normalizeMetadata({});
let songs = [];
let deviceId = "";
let player;
let drive;
let appReady;
const objectUrls = new Map();

function setStatus(message) {
  if (statusText) statusText.textContent = message;
}

function songKey(song) {
  return song.driveFileId || `local-${song.id}`;
}

function isFavorite(song) {
  return metadata.favorites.includes(songKey(song));
}

function getSongById(id) {
  return songs.find(song => song.id === id) || null;
}

async function loadMetadata() {
  const record = await dbRequest("settings", "readonly", store => store.get("library"));
  metadata = normalizeMetadata(record?.value || {});
}

async function persistMetadata(syncToCloud = true) {
  metadata.updatedAt = Date.now();
  metadata.version = 2;
  await dbRequest("settings", "readwrite", store => store.put({key: "library", value: metadata}));

  let cloudSynced = false;
  if (syncToCloud && drive?.isConnected()) {
    try {
      const synced = await drive.saveMetadata(structuredClone(metadata));
      if (synced) {
        metadata = mergeMetadata(metadata, synced);
        await dbRequest("settings", "readwrite", store => store.put({key: "library", value: metadata}));
        cloudSynced = true;
      }
    } catch (error) {
      console.error("Lokale Metadaten wurden gespeichert, Cloud-Sync fehlgeschlagen:", error);
      setStatus(`Lokal gespeichert · Cloud-Synchronisierung fehlgeschlagen: ${error.message}`);
    }
  }
  return cloudSynced;
}

async function setCloudMetadata(value, syncToCloud = false) {
  metadata = mergeMetadata(metadata, value);
  await dbRequest("settings", "readwrite", store => store.put({key: "library", value: metadata}));
  if (syncToCloud && drive?.isConnected()) await persistMetadata(true);
  renderAll();
  return metadata;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function isSafeImageDataUrl(src) {
  return typeof src === "string" && src.length < 1_500_000 && /^data:image\/(?:jpeg|png|webp|gif);base64,/i.test(src);
}

function makeImageElement(src, className, alt = "") {
  if (!isSafeImageDataUrl(src)) return null;
  const image = document.createElement("img");
  image.src = src;
  image.className = className;
  image.alt = alt;
  image.loading = "lazy";
  return image;
}

async function imageToDataUrl(file) {
  if (!file || !file.type.startsWith("image/")) throw new Error("Bitte wähle eine Bilddatei aus.");
  if (file.size > 12 * 1024 * 1024) throw new Error("Das Bild ist zu groß (maximal 12 MB).");
  if (typeof createImageBitmap !== "function") throw new Error("Dein Browser unterstützt die Bildverarbeitung nicht.");
  const source = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 600 / Math.max(source.width, source.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Das Coverbild konnte nicht verarbeitet werden.");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.78);
  } finally {
    source.close?.();
  }
}

function chooseImage() {
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try { resolve(await imageToDataUrl(file)); }
      catch (error) { alert(error.message); resolve(null); }
    };
    input.click();
  });
}

function touchPlaylist(playlist) {
  playlist.updatedAt = Date.now();
  playlist.deviceId = deviceId;
}

async function refreshSongs() {
  const stored = await getSongs();
  const validIds = new Set(stored.map(song => song.id));
  for (const [id, url] of objectUrls) {
    if (!validIds.has(id)) {
      URL.revokeObjectURL(url);
      objectUrls.delete(id);
    }
  }

  songs = stored.filter(song => song.file).map(song => {
    let url = objectUrls.get(song.id);
    if (!url) {
      url = URL.createObjectURL(song.file);
      objectUrls.set(song.id, url);
    }
    return {...song, url};
  });

  if (player?.currentSongId != null && !getSongById(player.currentSongId)) {
    player.stop();
  }
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
  const query = searchInput.value.trim().toLocaleLowerCase("de-DE");
  const activePlaylist = activePlaylistId
    ? metadata.playlists.find(item => item.id === activePlaylistId)
    : null;
  const querySelectsPlaylist = Boolean(activePlaylist && activePlaylist.name.toLocaleLowerCase("de-DE").includes(query));
  if (query && !querySelectsPlaylist) {
    list = list.filter(song => song.name.toLocaleLowerCase("de-DE").includes(query));
  }

  switch (sortSelect.value) {
    case "oldest": list.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0)); break;
    case "newest": list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)); break;
    default: list.sort((a, b) => a.name.localeCompare(b.name, "de", {sensitivity: "base"}));
  }
  return list;
}

function makeButton(label, className, title, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = className;
  button.title = title;
  button.addEventListener("click", onClick);
  return button;
}

function renderPlaylists() {
  playlistList.replaceChildren();
  const query = searchInput.value.trim().toLocaleLowerCase("de-DE");
  const visiblePlaylists = metadata.playlists.filter(playlist => !query || playlist.name.toLocaleLowerCase("de-DE").includes(query));

  const favoritesCard = document.createElement("article");
  favoritesCard.className = `playlist-card ${currentView === "favorites" ? "selected" : ""}`;
  const favoritesCover = document.createElement("div");
  favoritesCover.className = "playlist-placeholder favorite-placeholder";
  favoritesCover.textContent = "♥";
  const favoritesDetails = document.createElement("div");
  favoritesDetails.className = "playlist-details";
  const favoritesTitle = document.createElement("strong");
  favoritesTitle.textContent = "Meine Favoriten";
  const favoritesCount = document.createElement("span");
  favoritesCount.className = "playlist-count";
  favoritesCount.textContent = `${metadata.favorites.length} Songs`;
  const favoritesOpen = makeButton("Öffnen", "small-button", "Favoriten öffnen", () => {
    currentView = currentView === "favorites" ? "all" : "favorites";
    activePlaylistId = null;
    renderAll();
  });
  const favoritesActions = document.createElement("div");
  favoritesActions.className = "playlist-actions";
  favoritesActions.append(favoritesOpen);
  favoritesDetails.append(favoritesTitle, favoritesCount, favoritesActions);
  favoritesCard.append(favoritesCover, favoritesDetails);
  playlistList.appendChild(favoritesCard);

  for (const playlist of visiblePlaylists) {
    const card = document.createElement("article");
    card.className = `playlist-card ${activePlaylistId === playlist.id ? "selected" : ""}`;
    const cover = playlist.cover ? makeImageElement(playlist.cover, "playlist-cover", playlist.name) : null;
    if (cover) card.appendChild(cover);
    else {
      const placeholder = document.createElement("div");
      placeholder.className = "playlist-placeholder";
      placeholder.textContent = "♫";
      card.appendChild(placeholder);
    }

    const details = document.createElement("div");
    details.className = "playlist-details";
    const title = document.createElement("strong");
    title.textContent = playlist.name;
    const count = document.createElement("span");
    count.className = "playlist-count";
    count.textContent = `${playlist.songIds.length} Songs`;
    const actions = document.createElement("div");
    actions.className = "playlist-actions";
    actions.append(
      makeButton(activePlaylistId === playlist.id ? "Schließen" : "Öffnen", "small-button", "Playlist öffnen", () => {
        activePlaylistId = activePlaylistId === playlist.id ? null : playlist.id;
        currentView = "all";
        renderAll();
      }),
      makeButton("Umbenennen", "small-button", "Playlist umbenennen", async () => {
        const name = prompt("Neuer Playlistname:", playlist.name);
        if (!name?.trim()) return;
        playlist.name = name.trim().slice(0, 100);
        touchPlaylist(playlist);
        await persistMetadata();
        renderAll();
      }),
      makeButton("Cover", "small-button", "Playlist-Cover ändern", async () => {
        const coverData = await chooseImage();
        if (!coverData) return;
        playlist.cover = coverData;
        touchPlaylist(playlist);
        await persistMetadata();
        renderAll();
      }),
      makeButton("Löschen", "small-button danger-button", "Playlist löschen", async () => {
        if (!confirm(`Playlist „${playlist.name}“ wirklich löschen? Die Songs bleiben erhalten.`)) return;
        metadata.deletedPlaylistIds[playlist.id] = {deletedAt: Date.now(), deviceId};
        metadata.playlists = metadata.playlists.filter(item => item.id !== playlist.id);
        if (activePlaylistId === playlist.id) activePlaylistId = null;
        await persistMetadata();
        renderAll();
      })
    );
    details.append(title, count, actions);
    card.appendChild(details);
    playlistList.appendChild(card);
  }
}

function renderSongs() {
  songList.replaceChildren();
  const list = currentSongs();
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "empty-music";
    const icon = document.createElement("span");
    icon.textContent = "🎶";
    const heading = document.createElement("h3");
    heading.textContent = songs.length ? "Keine passenden Songs" : "Noch keine Musik vorhanden";
    const message = document.createElement("p");
    message.textContent = songs.length ? "Ändere deine Suche oder den Filter." : "Füge deine eigenen Songs hinzu.";
    empty.append(icon, heading, message);
    songList.appendChild(empty);
    return;
  }

  for (const song of list) {
    const item = document.createElement("article");
    item.className = `song-item ${player?.currentSongId === song.id ? "active" : ""}`;
    const coverData = metadata.songCovers[songKey(song)];
    const cover = coverData ? makeImageElement(coverData, "song-cover", `${song.name} Cover`) : null;
    if (cover) item.appendChild(cover);
    else {
      const placeholder = document.createElement("div");
      placeholder.className = "song-placeholder";
      placeholder.textContent = "♫";
      item.appendChild(placeholder);
    }

    const info = document.createElement("button");
    info.type = "button";
    info.className = "song-item-info song-play-trigger";
    info.title = `„${song.name}“ abspielen`;
    const name = document.createElement("strong");
    name.textContent = song.name;
    const sub = document.createElement("span");
    sub.textContent = song.driveFileId ? "Eigene Musik · Cloud-synchronisiert" : "Eigene Musik · Nur auf diesem Gerät";
    info.append(name, sub);
    info.addEventListener("click", () => player.playSong(song, list));

    const actions = document.createElement("div");
    actions.className = "song-actions";
    actions.append(
      makeButton(isFavorite(song) ? "♥" : "♡", `icon-action ${isFavorite(song) ? "favorite" : ""}`, "Favorit umschalten", async () => {
        metadata = setFavoriteState(metadata, songKey(song), !isFavorite(song), deviceId);
        await persistMetadata();
        renderAll();
      }),
      makeButton("Bild", "compact-action", "Coverbild hinzufügen", async () => {
        const cover = await chooseImage();
        if (!cover) return;
        metadata = setCoverState(metadata, songKey(song), cover, deviceId);
        await persistMetadata();
        renderAll();
      }),
      makeButton("+ Liste", "compact-action", "Zu Playlist hinzufügen", async () => {
        if (!metadata.playlists.length) {
          alert("Erstelle zuerst eine Playlist.");
          return;
        }
        const choice = prompt(`Playlist auswählen:\n${metadata.playlists.map((playlist, index) => `${index + 1}: ${playlist.name}`).join("\n")}\n\nNummer eingeben:`);
        if (choice === null) return;
        const selected = metadata.playlists[Number(choice) - 1];
        if (!selected) return;
        selected.songIds = [...new Set([...selected.songIds, songKey(song)])];
        touchPlaylist(selected);
        await persistMetadata();
        setStatus(`„${song.name}“ wurde zu „${selected.name}“ hinzugefügt.`);
      }),
      makeButton("Nächste", "compact-action", "Song als Nächstes abspielen", () => {
        const added = player.enqueueNext(song);
        setStatus(added ? `„${song.name}“ zur Wiedergabewarteschlange hinzugefügt.` : "Der Song ist bereits in der Warteschlange.");
        renderQueue();
      }),
      makeButton("Löschen", "compact-action danger-button", "Song löschen", () => deleteSong(song))
    );

    item.append(info, actions);
    songList.appendChild(item);
  }
}

function renderQueue() {
  queueList.replaceChildren();
  if (!player) return;
  const upcoming = player.getUpcomingSongs(8);
  if (!upcoming.length) {
    const empty = document.createElement("p");
    empty.className = "queue-empty";
    empty.textContent = player.currentSongId ? "Keine weiteren Songs in der Warteschlange." : "Starte einen Song, um die Warteschlange zu füllen.";
    queueList.appendChild(empty);
  } else {
    upcoming.forEach((song, index) => {
      const row = document.createElement("div");
      row.className = "queue-row";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "queue-item";
      button.draggable = true;
      button.title = "Zum Abspielen anklicken oder per Drag-and-drop verschieben";
      const handle = document.createElement("span");
      handle.className = "queue-drag-handle";
      handle.textContent = "⠿";
      const title = document.createElement("span");
      title.className = "queue-title";
      title.textContent = song.name;
      const play = document.createElement("span");
      play.textContent = "▶";
      button.append(handle, title, play);
      button.addEventListener("click", () => player.playQueuedId(song.id));
      button.addEventListener("dragstart", event => {
        event.dataTransfer?.setData("text/plain", String(song.id));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      });
      button.addEventListener("dragover", event => event.preventDefault());
      button.addEventListener("drop", event => {
        event.preventDefault();
        const draggedId = Number(event.dataTransfer?.getData("text/plain"));
        if (Number.isFinite(draggedId)) player.moveQueuedSong(draggedId, index);
      });
      const remove = makeButton("×", "queue-remove", `„${song.name}“ aus der Warteschlange entfernen`, () => {
        player.removeQueuedSong(song.id);
      });
      row.append(button, remove);
      queueList.appendChild(row);
    });
    queueList.ondragover = event => event.preventDefault();
    queueList.ondrop = event => {
      if (event.target !== queueList) return;
      event.preventDefault();
      const draggedId = Number(event.dataTransfer?.getData("text/plain"));
      if (Number.isFinite(draggedId)) player.moveQueuedSong(draggedId, upcoming.length);
    };
  }

  const shuffleButton = byId("shuffle-btn");
  shuffleButton.classList.toggle("active-control", player.shuffle);
  shuffleButton.setAttribute("aria-pressed", String(player.shuffle));
  shuffleButton.title = player.shuffle ? "Zufallswiedergabe ausschalten" : "Zufallswiedergabe einschalten";
  const repeatButton = byId("repeat-btn");
  repeatButton.classList.toggle("active-control", player.repeat !== "off");
  repeatButton.textContent = player.repeat === "one" ? "🔂" : "🔁";
  repeatButton.setAttribute("aria-pressed", String(player.repeat !== "off"));
  repeatButton.title = player.repeat === "off" ? "Wiederholung einschalten" : player.repeat === "all" ? "Einen Song wiederholen" : "Wiederholung ausschalten";
}

function renderAll() {
  renderPlaylists();
  renderSongs();
  renderQueue();
  byId("show-all-button").classList.toggle("active", currentView === "all" && !activePlaylistId);
  byId("show-all-button").setAttribute("aria-pressed", String(currentView === "all" && !activePlaylistId));
  byId("show-favorites-button").classList.toggle("active", currentView === "favorites");
  byId("show-favorites-button").setAttribute("aria-pressed", String(currentView === "favorites"));
  const activePlaylist = metadata.playlists.find(item => item.id === activePlaylistId);
  byId("section-title").textContent = activePlaylist?.name || (currentView === "favorites" ? "Meine Favoriten" : "Deine Musik");
  byId("library-count").textContent = `${songs.length} Songs in deiner Bibliothek`;
}

function updateCurrentSong(song, error = null) {
  if (!song) {
    byId("current-title").textContent = "Kein Song ausgewählt";
    byId("current-artist").textContent = "MySpotify";
    byId("player-cover").hidden = true;
    byId("player-cover-placeholder").hidden = false;
    byId("player-cover-placeholder").textContent = "🎵";
    byId("progress").value = 0;
    byId("current-time").textContent = "0:00";
    byId("duration").textContent = "0:00";
  } else {
    byId("current-title").textContent = song.name;
    byId("current-artist").textContent = song.driveFileId ? "Eigene Musik · Cloud" : "Eigene Musik · Lokal";
    const cover = metadata.songCovers[songKey(song)];
    const safeCover = isSafeImageDataUrl(cover) ? cover : null;
    byId("player-cover").hidden = !safeCover;
    byId("player-cover-placeholder").hidden = Boolean(safeCover);
    if (safeCover) byId("player-cover").src = safeCover;
    byId("progress").value = 0;
    byId("current-time").textContent = "0:00";
    byId("duration").textContent = "0:00";
  }
  if (error) setStatus(`Wiedergabe konnte nicht gestartet werden: ${error.message}`);
  byId("play-btn").textContent = audio.paused ? "▶" : "Ⅱ";
  renderSongs();
  renderQueue();
}

async function deleteSong(song) {
  const isCloudSong = Boolean(song.driveFileId);
  const details = isCloudSong
    ? "Der Song wird aus deiner lokalen Bibliothek entfernt und in Google Drive zur Löschung markiert. Andere verbundene Geräte übernehmen die Löschung beim nächsten Sync."
    : "Der Song wird von diesem Gerät gelöscht.";
  if (!confirm(`„${song.name}“ wirklich löschen?\n\n${details}\n\nDieser Vorgang kann nicht rückgängig gemacht werden.`)) return;

  try {
    if (isCloudSong) metadata.deletedSongIds = [...new Set([...metadata.deletedSongIds, song.driveFileId])];
    metadata = setFavoriteState(metadata, songKey(song), false, deviceId);
    metadata = setCoverState(metadata, songKey(song), null, deviceId);
    metadata.playlists = metadata.playlists.map(playlist => {
      const next = {...playlist, songIds: playlist.songIds.filter(id => id !== songKey(song))};
      if (next.songIds.length !== playlist.songIds.length) touchPlaylist(next);
      return next;
    });

    // Die Löschmarkierung wird zuerst lokal und, falls verbunden, in der Cloud gesichert.
    const cloudMetadataSaved = await persistMetadata(true);
    let cloudDeletePending = isCloudSong && !cloudMetadataSaved;
    if (isCloudSong && drive?.isConnected() && cloudMetadataSaved) {
      try { await drive.deleteDriveFile(song.driveFileId); }
      catch (error) {
        cloudDeletePending = true;
        console.warn("Cloud-Datei wird bei der nächsten Synchronisierung erneut entfernt:", error);
      }
    }

    player.removeSong(song.id);
    await removeSong(song.id);
    await refreshSongs();
    setStatus(cloudDeletePending
      ? "Song lokal gelöscht. Die Cloud-Löschung wird beim nächsten Google-Drive-Sync übernommen."
      : isCloudSong ? "Song gelöscht und für alle verbundenen Geräte vorgemerkt." : "Song lokal gelöscht.");
  } catch (error) {
    console.error(error);
    setStatus(`Löschen fehlgeschlagen: ${error.message}`);
    alert(`Der Song konnte nicht vollständig gelöscht werden: ${error.message}`);
  }
}

async function handleUploads(event) {
  const files = Array.from(event.target.files || []);
  uploadInput.value = "";
  if (!files.length) return;
  let count = 0;
  let skipped = 0;
  setStatus(`Speichere ${files.length} ausgewählte Datei(en) …`);
  for (const file of files) {
    if (!isAudioFile(file)) {
      skipped += 1;
      continue;
    }
    try {
      await addSong({name: file.name.replace(/\.[^/.]+$/, ""), file, addedAt: Date.now()});
      count += 1;
    } catch (error) {
      console.error(`Song konnte nicht gespeichert werden (${file.name}):`, error);
      skipped += 1;
    }
  }
  await refreshSongs();
  setStatus(`${count} Song(s) lokal gespeichert${skipped ? ` · ${skipped} Datei(en) übersprungen` : ""}.`);
  if (count && drive?.isConnected()) {
    try { await drive.synchronizeSongs(); }
    catch (error) { console.error(error); }
  }
}

async function createPlaylist() {
  const name = prompt("Wie soll deine neue Playlist heißen?");
  if (!name?.trim()) return;
  metadata.playlists.push({
    id: makeId(), name: name.trim().slice(0, 100), songIds: [], cover: null,
    updatedAt: Date.now(), deviceId
  });
  currentView = "all";
  activePlaylistId = metadata.playlists.at(-1).id;
  await persistMetadata();
  renderAll();
}

function bindEvents() {
  uploadInput.addEventListener("change", handleUploads);
  byId("create-playlist-button").addEventListener("click", createPlaylist);
  byId("show-all-button").addEventListener("click", () => {
    currentView = "all";
    activePlaylistId = null;
    renderAll();
  });
  byId("show-favorites-button").addEventListener("click", () => {
    currentView = "favorites";
    activePlaylistId = null;
    renderAll();
  });
  searchInput.addEventListener("input", renderAll);
  sortSelect.addEventListener("change", renderSongs);
  byId("nav-home").addEventListener("click", () => {
    currentView = "all"; activePlaylistId = null; searchInput.value = ""; renderAll();
  });
  byId("nav-search").addEventListener("click", () => searchInput.focus());
  byId("nav-library").addEventListener("click", () => {
    currentView = "all"; activePlaylistId = null; renderAll();
  });
  byId("play-btn").addEventListener("click", () => {
    if (!player.currentSongId && player.queueIds.length === 0) {
      const list = currentSongs();
      if (list.length) player.playSong(list[0], list);
      return;
    }
    player.togglePlay();
  });
  byId("previous-btn").addEventListener("click", () => player.previous());
  byId("next-btn").addEventListener("click", () => player.next());
  byId("shuffle-btn").addEventListener("click", () => player.toggleShuffle());
  byId("repeat-btn").addEventListener("click", () => {
    const mode = player.cycleRepeat();
    setStatus(`Wiederholung: ${mode === "off" ? "Aus" : mode === "all" ? "Ganze Warteschlange" : "Ein Song"}.`);
  });
  byId("progress").addEventListener("input", () => {
    if (Number.isFinite(audio.duration)) audio.currentTime = Number(byId("progress").value) / 100 * audio.duration;
  });
  byId("volume").addEventListener("input", () => { audio.volume = Number(byId("volume").value); });

  audio.addEventListener("play", () => { byId("play-btn").textContent = "Ⅱ"; });
  audio.addEventListener("pause", () => { byId("play-btn").textContent = "▶"; });
  audio.addEventListener("timeupdate", () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      byId("progress").value = audio.currentTime / audio.duration * 100;
      byId("current-time").textContent = formatTime(audio.currentTime);
    }
  });
  audio.addEventListener("loadedmetadata", () => {
    byId("duration").textContent = formatTime(audio.duration);
    byId("current-time").textContent = formatTime(audio.currentTime);
    byId("progress").value = 0;
  });
  audio.addEventListener("error", () => {
    if (player.currentSongId != null) setStatus("Die Audiodatei konnte nicht gelesen werden. Prüfe, ob das Format von deinem Browser unterstützt wird.");
  });

  document.addEventListener("keydown", event => {
    const target = event.target;
    const isTyping = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
    if (isTyping || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.code === "Space") {
      event.preventDefault();
      player.togglePlay();
    } else if (event.code === "ArrowRight" && player.currentSongId) {
      audio.currentTime = Math.min(Number.isFinite(audio.duration) ? audio.duration : audio.currentTime + 5, audio.currentTime + 5);
    } else if (event.code === "ArrowLeft" && player.currentSongId) {
      audio.currentTime = Math.max(0, audio.currentTime - 5);
    } else if (event.key.toLowerCase() === "n") {
      player.next();
    }
  });
}

async function initializeApp() {
  try {
    setStatus("Gespeicherte Musik wird geladen …");
    await openDatabase();
    deviceId = await getOrCreateDeviceId();
    await loadMetadata();
    player = new MusicPlayer(audio, getSongById, updateCurrentSong, renderQueue);
    await refreshSongs();
    audio.volume = Number(byId("volume").value) || 0.7;
    setStatus(`${songs.length} gespeicherte Songs geladen.`);
  } catch (error) {
    console.error("Startfehler:", error);
    setStatus(`MySpotify konnte nicht gestartet werden: ${error.message}`);
    throw error;
  }
}

appReady = initializeApp();

drive = createGoogleDrive({
  getMetadata: async () => { await appReady; return structuredClone(metadata); },
  setMetadata: setCloudMetadata,
  getStoredSongs,
  saveDownloadedSong: addSong,
  setDriveFileId: async (songId, driveFileId) => {
    await appReady;
    const stored = await getSongs();
    const song = stored.find(item => item.id === songId);
    if (!song) throw new Error("Lokaler Song wurde nicht gefunden.");
    const oldKey = song.driveFileId || `local-${song.id}`;
    const newKey = driveFileId || `local-${song.id}`;
    metadata = migrateSongMetadata(metadata, oldKey, newKey, deviceId);
    await dbRequest("settings", "readwrite", store => store.put({key: "library", value: metadata}));
    if (driveFileId) song.driveFileId = driveFileId;
    else delete song.driveFileId;
    await putSong(song);
  },
  deleteLocalSong: removeSong,
  refreshLibrary: refreshSongs,
  waitUntilReady: () => appReady,
  setStatus
});

appReady.then(bindEvents).catch(() => {
  setStatus("Die App konnte nicht initialisiert werden. Bitte lade die Seite neu.");
});

window.addEventListener("beforeunload", () => {
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
});

// Kleine, bewusst lesbare Debug-Schnittstelle für lokale Fehlersuche.
window.MySpotify = {
  getState: () => ({songCount: songs.length, currentSongId: player?.currentSongId ?? null, playlistCount: metadata.playlists.length, initialized: Boolean(player)}),
  sync: () => drive.synchronizeSongs(),
  connectGoogleDrive: () => drive.connect()
};
