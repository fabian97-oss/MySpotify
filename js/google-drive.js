import {mergeMetadata} from "./metadata.js";

const GOOGLE_CLIENT_ID = "549476284025-chhtts628n343481h3ipoomikrkmem2q.apps.googleusercontent.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_FOLDER_NAME = "MySpotify Music";
const METADATA_FILE_NAME = "myspotify-library.json";
const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024; // Vielfaches von 256 KiB

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const audioExtensions = /\.(mp3|wav|ogg|m4a|aac|flac|opus|aiff|wma)$/i;

function getAudioMimeType(file) {
  if (file?.type?.startsWith("audio/")) return file.type;
  const extension = String(file?.name || "").split(".").pop()?.toLowerCase();
  return ({
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4",
    aac: "audio/aac", flac: "audio/flac", opus: "audio/opus", aiff: "audio/aiff", wma: "audio/x-ms-wma"
  })[extension] || "application/octet-stream";
}

function isAudioFile(file) {
  return Boolean(file?.mimeType?.startsWith("audio/") || audioExtensions.test(file?.name || ""));
}

export function createGoogleDrive({
  getMetadata,
  setMetadata,
  getStoredSongs,
  saveDownloadedSong,
  setDriveFileId,
  deleteLocalSong,
  refreshLibrary,
  waitUntilReady,
  setStatus
}) {
  let accessToken = null;
  let tokenClient = null;
  let pendingToken = null;
  let driveFolderId = null;
  let syncPromise = null;
  let metadataWriteQueue = Promise.resolve();

  const connectButton = document.getElementById("google-connect-button");

  function setButtonConnected(connected) {
    if (!connectButton) return;
    connectButton.textContent = connected ? "✓ Google Drive verbunden · Jetzt synchronisieren" : "☁️ Mit Google Drive verbinden";
    connectButton.classList.toggle("connected", connected);
  }

  function initTokenClient() {
    if (tokenClient) return;
    if (!window.google?.accounts?.oauth2) {
      throw new Error("Die Google-Anmeldung wurde nicht geladen. Bitte prüfe deine Internetverbindung und lade die Seite neu.");
    }
    if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.includes("HIER_DEINE")) {
      throw new Error("Bitte trage eine gültige Google-Client-ID in js/google-drive.js ein.");
    }
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: response => {
        if (!pendingToken) return;
        const pending = pendingToken;
        pendingToken = null;
        clearTimeout(pending.timer);
        if (response.error || !response.access_token) {
          pending.reject(new Error(response.error_description || response.error || "Google-Anmeldung fehlgeschlagen."));
          return;
        }
        accessToken = response.access_token;
        pending.resolve(accessToken);
      },
      error_callback: error => {
        if (!pendingToken) return;
        const pending = pendingToken;
        pendingToken = null;
        clearTimeout(pending.timer);
        pending.reject(new Error(error?.message || "Das Google-Anmeldefenster konnte nicht geöffnet werden."));
      }
    });
  }

  function requestAccessToken(prompt = "") {
    initTokenClient();
    if (pendingToken) return Promise.reject(new Error("Eine Google-Anmeldung läuft bereits."));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pendingToken) return;
        pendingToken = null;
        reject(new Error("Die Google-Anmeldung wurde nicht abgeschlossen. Bitte versuche es erneut."));
      }, 60_000);
      pendingToken = {resolve, reject, timer};
      try {
        tokenClient.requestAccessToken({prompt});
      } catch (error) {
        clearTimeout(timer);
        pendingToken = null;
        reject(error);
      }
    });
  }


  async function authorizedFetch(url, options = {}) {
    if (!accessToken) throw new Error("Google Drive ist nicht verbunden.");
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${accessToken}`);
    const response = await fetch(url, {...options, headers});
    if (response.status === 401) {
      // Google Identity Services verlangt für neue Tokens einen bewussten Nutzerimpuls.
      // Deshalb keinen unerwarteten Popup-Dialog aus einem Hintergrund-Sync öffnen.
      accessToken = null;
      setButtonConnected(false);
      throw new Error("Deine Google-Sitzung ist abgelaufen. Bitte klicke erneut auf „Mit Google Drive verbinden“.");
    }
    return response;
  }

  async function driveJson(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && typeof options.body === "string" && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const response = await authorizedFetch(url, {...options, headers});
    if (!response.ok && response.status !== 204) {
      const details = await response.text().catch(() => "");
      const error = new Error(`Google Drive (${response.status}): ${details || response.statusText}`);
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) return null;
    const contentType = response.headers.get("content-type") || "";
    return contentType.includes("application/json") ? response.json() : response.text();
  }

  async function listFiles(query, pageSize = 1000) {
    const allFiles = [];
    let pageToken = null;
    do {
      const params = new URLSearchParams({
        q: query,
        pageSize: String(pageSize),
        fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime,parents)",
        orderBy: "name"
      });
      if (pageToken) params.set("pageToken", pageToken);
      const result = await driveJson(`https://www.googleapis.com/drive/v3/files?${params}`);
      allFiles.push(...(result.files || []));
      pageToken = result.nextPageToken || null;
    } while (pageToken);
    return allFiles;
  }

  async function ensureDriveFolder() {
    if (driveFolderId) return driveFolderId;
    const safeName = DRIVE_FOLDER_NAME.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const query = `name='${safeName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const folders = await listFiles(query, 100);
    if (folders.length) {
      driveFolderId = folders[0].id;
      return driveFolderId;
    }
    const created = await driveJson("https://www.googleapis.com/drive/v3/files?fields=id", {
      method: "POST",
      body: JSON.stringify({name: DRIVE_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder"})
    });
    driveFolderId = created.id;
    return driveFolderId;
  }

  async function listFolderFiles() {
    await ensureDriveFolder();
    return listFiles(`'${driveFolderId}' in parents and trashed=false`);
  }

  async function uploadBlob(name, blob, mimeType, existingId = null, onProgress = () => {}) {
    if (!blob || blob.size === 0) throw new Error(`„${name}“ ist leer und kann nicht hochgeladen werden.`);
    const metadata = {
      name,
      mimeType,
      ...(existingId ? {} : {parents: [driveFolderId]})
    };
    const endpoint = existingId
      ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingId)}?uploadType=resumable&fields=id,name,mimeType,size,modifiedTime`
      : "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,modifiedTime";

    const sessionResponse = await authorizedFetch(endpoint, {
      method: existingId ? "PATCH" : "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": String(blob.size)
      },
      body: JSON.stringify(metadata)
    });
    if (!sessionResponse.ok) {
      const details = await sessionResponse.text().catch(() => "");
      throw new Error(`Upload konnte nicht vorbereitet werden (${sessionResponse.status}): ${details || sessionResponse.statusText}`);
    }
    const uploadUrl = sessionResponse.headers.get("Location");
    if (!uploadUrl) throw new Error("Google Drive hat keine Upload-Sitzung zurückgegeben.");

    let offset = 0;
    let retries = 0;
    while (offset < blob.size) {
      const endExclusive = Math.min(offset + UPLOAD_CHUNK_SIZE, blob.size);
      const chunk = blob.slice(offset, endExclusive);
      const headers = {
        "Content-Range": `bytes ${offset}-${endExclusive - 1}/${blob.size}`
      };

      let response;
      try {
        response = await fetch(uploadUrl, {method: "PUT", headers, body: chunk});
      } catch (error) {
        retries += 1;
        if (retries > 4) throw new Error(`Upload-Verbindung unterbrochen: ${error.message}`);
        await wait(500 * (2 ** (retries - 1)));
        const state = await queryUploadStatus(uploadUrl, blob.size);
        if (state.completed) return state.result;
        offset = state.offset;
        continue;
      }

      if (response.status === 308) {
        const range = response.headers.get("Range");
        const match = range?.match(/bytes=0-(\d+)/);
        offset = match ? Number(match[1]) + 1 : endExclusive;
        retries = 0;
        onProgress(blob.size ? Math.min(100, offset / blob.size * 100) : 100);
        continue;
      }
      if (response.ok) {
        onProgress(100);
        return response.json();
      }

      if ((response.status === 429 || response.status >= 500) && retries < 4) {
        retries += 1;
        await wait(500 * (2 ** (retries - 1)));
        const state = await queryUploadStatus(uploadUrl, blob.size);
        if (state.completed) return state.result;
        offset = state.offset;
        continue;
      }
      const details = await response.text().catch(() => "");
      throw new Error(`Upload fehlgeschlagen (${response.status}): ${details || response.statusText}`);
    }
    throw new Error("Upload wurde unerwartet beendet.");
  }

  async function queryUploadStatus(uploadUrl, totalSize) {
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {"Content-Range": `bytes */${totalSize}`},
      body: new Blob([])
    });
    if (response.status === 308) {
      const match = response.headers.get("Range")?.match(/bytes=0-(\d+)/);
      return {offset: match ? Number(match[1]) + 1 : 0, completed: false};
    }
    if (response.ok) return {offset: totalSize, completed: true, result: await response.json()};
    if (response.status === 404 || response.status === 410) throw new Error("Die Upload-Sitzung ist abgelaufen. Bitte starte die Synchronisierung erneut.");
    throw new Error(`Upload-Status konnte nicht abgefragt werden (${response.status}).`);
  }

  function findMetadataFile(files) {
    return files
      .filter(file => file.name === METADATA_FILE_NAME && file.mimeType !== "application/vnd.google-apps.folder")
      .sort((a, b) => String(b.modifiedTime || "").localeCompare(String(a.modifiedTime || "")))[0] || null;
  }

  async function readMetadata(fileId) {
    const response = await authorizedFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`);
    if (!response.ok) {
      const error = new Error(`Cloud-Metadaten konnten nicht gelesen werden (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    const value = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Die Cloud-Metadaten haben ein ungültiges Format.");
    return value;
  }

  async function saveCloudMetadata(metadata, existingId = null) {
    const blob = new Blob([JSON.stringify(metadata)], {type: "application/json"});
    const saved = await uploadBlob(METADATA_FILE_NAME, blob, "application/json", existingId);
    return saved.id;
  }

  async function deleteDriveFile(fileId) {
    if (!fileId || !accessToken) return;
    const response = await authorizedFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {method: "DELETE"});
    if (response.status === 404) return;
    if (!response.ok && response.status !== 204) {
      const details = await response.text().catch(() => "");
      throw new Error(`Datei konnte nicht aus Google Drive gelöscht werden (${response.status}): ${details}`);
    }
  }

  async function downloadBlob(file, onProgress = () => {}) {
    const response = await authorizedFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`);
    if (!response.ok) throw new Error(`„${file.name}“ konnte nicht heruntergeladen werden (${response.status}).`);
    const total = Number(response.headers.get("content-length")) || Number(file.size) || 0;
    if (!response.body?.getReader) {
      const blob = await response.blob();
      onProgress(100);
      return blob;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      if (total) onProgress(Math.min(100, received / total * 100));
    }
    onProgress(100);
    return new Blob(chunks, {type: file.mimeType || "application/octet-stream"});
  }

  async function writeMergedMetadata(localValue) {
    const operation = async () => {
      const files = await listFolderFiles();
      const remoteFile = findMetadataFile(files);
      const remote = remoteFile ? await readMetadata(remoteFile.id) : {};
      const merged = mergeMetadata(localValue, remote);
      await saveCloudMetadata(merged, remoteFile?.id || null);
      const stored = await setMetadata(merged, false);
      return stored || merged;
    };
    const pending = metadataWriteQueue.then(operation, operation);
    metadataWriteQueue = pending.catch(error => console.error("Metadaten-Synchronisierung fehlgeschlagen:", error));
    return pending;
  }

  async function synchronizeSongs() {
    if (!accessToken) {
      setStatus("Bitte verbinde zuerst Google Drive.");
      return;
    }
    if (syncPromise) return syncPromise;

    syncPromise = (async () => {
      if (waitUntilReady) await waitUntilReady();
      setStatus("Google Drive wird vorbereitet …");
      await ensureDriveFolder();
      let files = await listFolderFiles();
      let metadataFile = findMetadataFile(files);
      const localMetadata = await getMetadata();
      const remoteMetadata = metadataFile ? await readMetadata(metadataFile.id) : {};
      let mergedMetadata = mergeMetadata(localMetadata, remoteMetadata);
      await setMetadata(mergedMetadata, false);

      const deletedIds = new Set(mergedMetadata.deletedSongIds || []);
      for (const id of deletedIds) {
        try { await deleteDriveFile(id); }
        catch (error) { console.warn("Gelöschte Cloud-Datei konnte nicht sofort entfernt werden:", id, error); }
      }

      files = await listFolderFiles();
      const remoteAudio = files.filter(file => isAudioFile(file) && !deletedIds.has(file.id));
      const remoteIds = new Set(remoteAudio.map(file => file.id));
      let localSongs = await getStoredSongs();
      const totalWork = localSongs.filter(song => song.file).length + remoteAudio.length || 1;
      let completedWork = 0;

      for (const song of localSongs) {
        if (song.driveFileId && deletedIds.has(song.driveFileId)) {
          await deleteLocalSong(song.id);
          completedWork += 1;
          continue;
        }
        if (!song.file) continue;

        if (song.driveFileId && !remoteIds.has(song.driveFileId)) {
          // Die Datei wurde außerhalb von MySpotify aus dem Ordner entfernt.
          // Die lokale Kopie bleibt erhalten und wird mit einer neuen Drive-ID hochgeladen.
          await setDriveFileId(song.id, null);
          song.driveFileId = null;
        }

        if (!song.driveFileId) {
          const mimeType = getAudioMimeType(song.file);
          const displayName = song.file.name || `${song.name}.mp3`;
          setStatus(`Lade hoch (${Math.min(99, Math.round(completedWork / totalWork * 100))}%): ${displayName}`);
          const uploaded = await uploadBlob(displayName, song.file, mimeType, null, percent => {
            setStatus(`Lade hoch: ${displayName} · ${Math.round(percent)}%`);
          });
          await setDriveFileId(song.id, uploaded.id);
          remoteIds.add(uploaded.id);
        }
        completedWork += 1;
      }

      localSongs = await getStoredSongs();
      const localIds = new Set(localSongs.map(song => song.driveFileId).filter(Boolean));
      for (const file of remoteAudio) {
        if (localIds.has(file.id) || deletedIds.has(file.id)) continue;
        setStatus(`Lade herunter: ${file.name}`);
        const blob = await downloadBlob(file, percent => {
          setStatus(`Lade herunter: ${file.name} · ${Math.round(percent)}%`);
        });
        const safeFileName = file.name || `MySpotify-${Date.now()}`;
        const audioFile = new File([blob], safeFileName, {type: file.mimeType || blob.type || "application/octet-stream"});
        await saveDownloadedSong({
          name: safeFileName.replace(/\.[^/.]+$/, ""),
          file: audioFile,
          driveFileId: file.id,
          addedAt: Date.now()
        });
        localIds.add(file.id);
      }

      mergedMetadata = await writeMergedMetadata(await getMetadata());
      await refreshLibrary();
      setStatus(`Synchronisierung abgeschlossen · ${localIds.size} Cloud-Song(s) verfügbar.`);
      window.dispatchEvent(new CustomEvent("myspotify-drive-sync-complete"));
    })().catch(error => {
      console.error("Google-Drive-Synchronisierung fehlgeschlagen:", error);
      setStatus(`Google-Drive-Synchronisierung fehlgeschlagen: ${error.message}`);
      throw error;
    }).finally(() => { syncPromise = null; });

    return syncPromise;
  }

  async function saveMetadataToDrive(value) {
    if (!accessToken) return null;
    return writeMergedMetadata(value);
  }

  async function connect() {
    if (connectButton?.dataset.busy === "true") return;
    if (connectButton) {
      connectButton.dataset.busy = "true";
      connectButton.disabled = true;
      connectButton.setAttribute("aria-busy", "true");
    }
    try {
      if (accessToken) {
        await synchronizeSongs();
        return;
      }
      setStatus("Google-Anmeldung wird geöffnet … Falls kein Fenster erscheint, erlaube Pop-ups für diese Website.");
      await requestAccessToken("");
      setButtonConnected(true);
      setStatus("Google Drive verbunden. Synchronisierung startet …");
      await synchronizeSongs();
    } catch (error) {
      console.error("Google-Drive-Verbindung fehlgeschlagen:", error);
      const message = error?.message || String(error);
      const originHint = /origin_mismatch|unauthorized origin|origin.*not authorized/i.test(message)
        ? " Trage in Google Cloud unter „Autorisierte JavaScript-Ursprünge“ deine GitHub-Pages-Domain ein (nur https://name.github.io, ohne Repository-Pfad)."
        : " Prüfe auch, ob die Google Drive API aktiviert ist und dein Google-Konto im OAuth-Zustimmungsbildschirm als Testnutzer eingetragen ist.";
      setStatus(`Google Drive: ${message}${originHint}`);
      if (!accessToken) setButtonConnected(false);
    } finally {
      if (connectButton) {
        connectButton.dataset.busy = "false";
        connectButton.disabled = false;
        connectButton.removeAttribute("aria-busy");
      }
    }
  }

  connectButton?.addEventListener("click", connect);

  return {
    isConnected: () => Boolean(accessToken),
    synchronizeSongs,
    saveMetadata: saveMetadataToDrive,
    deleteDriveFile,
    disconnect: () => { accessToken = null; setButtonConnected(false); }
  };
}
