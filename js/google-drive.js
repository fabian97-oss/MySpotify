/* MySpotify Google-Drive-Synchronisierung
   Die Client-ID bleibt lokal in dieser Datei. Niemals einen Client Secret eintragen.
*/
const GOOGLE_CLIENT_ID = "549476284025-chhtts628n343481h3ipoomikrkmem2q.apps.googleusercontent.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_FOLDER_NAME = "MySpotify Music";
const METADATA_FILE_NAME = "myspotify-library.json";

let accessToken = null;
let tokenClient = null;
let driveFolderId = null;
let syncInProgress = false;

function driveRequest(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  return fetch(url, {...options, headers}).then(async response => {
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw new Error(`Google Drive Fehler ${response.status}: ${message || response.statusText}`);
    }
    if (response.status === 204) return null;
    const type = response.headers.get("content-type") || "";
    return type.includes("application/json") ? response.json() : response.text();
  });
}

async function ensureDriveFolder() {
  const q = encodeURIComponent(`name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const result = await driveRequest(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=100`);
  const folder = (result.files || [])[0];
  if (folder) return folder.id;
  const created = await driveRequest("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST", body: JSON.stringify({name: DRIVE_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder"})
  });
  return created.id;
}

async function listFolderFiles() {
  const q = encodeURIComponent(`'${driveFolderId}' in parents and trashed=false`);
  const result = await driveRequest(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size)&pageSize=1000`);
  return result.files || [];
}

async function uploadBlob(name, blob, mimeType, existingId = null) {
  const metadata = {name, mimeType, ...(existingId ? {} : {parents: [driveFolderId]})};
  const boundary = "-------myspotifyboundary";
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`
  ]);
  const endpoint = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id";
  const response = await fetch(endpoint, {
    method: existingId ? "PATCH" : "POST",
    headers: {Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary=${boundary}`},
    body
  });
  if (!response.ok) throw new Error(`Upload fehlgeschlagen (${response.status}): ${await response.text()}`);
  return response.json();
}

async function getMetadataFile(files) {
  return files.find(file => file.name === METADATA_FILE_NAME && file.mimeType !== "application/vnd.google-apps.folder") || null;
}

async function readMetadata(fileId) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: {Authorization: `Bearer ${accessToken}`}
  });
  if (!response.ok) throw new Error("Die MySpotify-Bibliothek in Google Drive konnte nicht gelesen werden.");
  return response.json();
}

async function getLocalMetadata() {
  return window.MySpotifyMusic.getMetadata();
}

async function saveCloudMetadata(metadata, existingId = null) {
  const blob = new Blob([JSON.stringify(metadata)], {type: "application/json"});
  const saved = await uploadBlob(METADATA_FILE_NAME, blob, "application/json", existingId);
  return saved.id;
}

async function deleteDriveFile(fileId) {
  if (!fileId) return;
  await driveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {method: "DELETE"});
}

async function synchronizeSongs() {
  if (!accessToken || syncInProgress) return;

  // Erst warten, bis script.js die IndexedDB-Datenbank geöffnet hat.
  // So kann kein Zugriff auf database.transaction() vor der Initialisierung erfolgen.
  if (window.MySpotifyMusic && window.MySpotifyMusic.ready) {
    await window.MySpotifyMusic.ready;
  }
  if (!window.MySpotifyMusic || typeof window.MySpotifyMusic.getStoredSongs !== "function") {
    throw new Error("MySpotify wurde noch nicht vollständig geladen. Bitte Seite neu laden.");
  }

  syncInProgress = true;
  try {
    driveFolderId = driveFolderId || await ensureDriveFolder();
    let files = await listFolderFiles();
    const remoteMetaFile = await getMetadataFile(files);
    let metadata;

    if (remoteMetaFile) {
      metadata = await readMetadata(remoteMetaFile.id);
      await window.MySpotifyMusic.setMetadata(metadata, false);
    } else {
      metadata = await getLocalMetadata();
    }

    const deleted = new Set(metadata.deletedSongIds || []);
    for (const id of deleted) {
      try { await deleteDriveFile(id); } catch (error) { console.warn("Gelöschte Drive-Datei war nicht mehr vorhanden:", id, error); }
    }

    files = await listFolderFiles();
    let localSongs = await window.MySpotifyMusic.getStoredSongs();
    const remoteAudio = files.filter(file => file.mimeType && file.mimeType.startsWith("audio/") && !deleted.has(file.id));
    const remoteIds = new Set(remoteAudio.map(file => file.id));
    const localIds = new Set(localSongs.map(song => song.driveFileId).filter(Boolean));

    for (const song of localSongs) {
      if (song.driveFileId && deleted.has(song.driveFileId)) {
        await window.MySpotifyMusic.deleteLocalSong(song.id);
        continue;
      }
      if (!song.driveFileId) {
        const mime = song.file.type || "audio/mpeg";
        const uploaded = await uploadBlob(song.file.name || `${song.name}.mp3`, song.file, mime);
        await window.MySpotifyMusic.setDriveFileId(song.id, uploaded.id);
        song.driveFileId = uploaded.id;
        localIds.add(uploaded.id);
      }
    }

    for (const file of remoteAudio) {
      if (localIds.has(file.id)) continue;
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
        headers: {Authorization: `Bearer ${accessToken}`}
      });
      if (!response.ok) throw new Error(`Song ${file.name} konnte nicht heruntergeladen werden.`);
      const blob = await response.blob();
      await window.MySpotifyMusic.saveDownloadedSong({
        name: file.name.replace(/\.[^/.]+$/, ""),
        file: blob,
        driveFileId: file.id,
        addedAt: Date.now()
      });
    }

    // Nach dem Upload die aktuelle Metadaten-Datei aktualisieren.
    metadata = await getLocalMetadata();
    const refreshed = await listFolderFiles();
    const metaFile = await getMetadataFile(refreshed);
    await saveCloudMetadata(metadata, metaFile ? metaFile.id : null);
    await window.MySpotifyMusic.refresh();
    window.dispatchEvent(new CustomEvent("myspotify-drive-sync-complete"));
  } catch (error) {
    console.error("Google-Drive-Synchronisierung fehlgeschlagen:", error);
    const status = document.getElementById("upload-status");
    if (status) status.textContent = `Google-Drive-Synchronisierung fehlgeschlagen: ${error.message}`;
  } finally {
    syncInProgress = false;
  }
}

async function saveMetadataToDrive(metadata) {
  if (!accessToken) return;
  driveFolderId = driveFolderId || await ensureDriveFolder();
  const files = await listFolderFiles();
  const metaFile = await getMetadataFile(files);
  await saveCloudMetadata(metadata, metaFile ? metaFile.id : null);
}

function connectGoogleDrive() {
  if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.includes("HIER_DEINE")) {
    alert("Bitte trage zuerst deine Google-Client-ID in google-drive.js ein.");
    return;
  }
  if (!window.google || !google.accounts || !google.accounts.oauth2) {
    alert("Google-Anmeldung ist noch nicht geladen. Bitte lade die Seite neu.");
    return;
  }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: async response => {
      if (response.error) {
        alert(`Google-Anmeldung fehlgeschlagen: ${response.error}`);
        return;
      }
      accessToken = response.access_token;
      const button = document.getElementById("google-connect-button");
      if (button) button.textContent = "✓ Google Drive verbunden";
      await synchronizeSongs();
      window.dispatchEvent(new Event("myspotify-drive-connected"));
    }
  });
  tokenClient.requestAccessToken({prompt: "consent"});
}

window.MySpotifyDrive = {
  isConnected: () => Boolean(accessToken),
  synchronizeSongs,
  saveMetadata: saveMetadataToDrive,
  deleteDriveFile
};

document.addEventListener("DOMContentLoaded", () => {
  const button = document.getElementById("google-connect-button");
  if (button) button.addEventListener("click", connectGoogleDrive);
});
