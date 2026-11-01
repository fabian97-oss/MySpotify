const GOOGLE_CLIENT_ID = "549476284025-chhtts628n343481h3ipoomikrkmem2q.apps.googleusercontent.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

let accessToken = null;
let musicFolderId = null;
let tokenClient = null;
let syncInProgress = false;

const connectButton = document.getElementById("google-connect-button");
const statusElement = document.getElementById("upload-status");

function showStatus(message) {
    if (statusElement) {
        statusElement.textContent = message;
    }
}

function connectGoogleDrive() {
    if (!window.google || !window.google.accounts) {
        showStatus("Google-Anmeldung konnte nicht geladen werden.");
        return;
    }

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,

        callback: async (response) => {
            if (response.error) {
                showStatus("Google-Anmeldung fehlgeschlagen: " + response.error);
                return;
            }

            accessToken = response.access_token;

            try {
                await findOrCreateMusicFolder();

                showStatus("Google Drive verbunden. Musik wird abgeglichen ...");

                if (connectButton) {
                    connectButton.textContent = "Google Drive verbunden";
                    connectButton.disabled = true;
                }

                window.dispatchEvent(
                    new CustomEvent("myspotify-drive-connected")
                );

            } catch (error) {
                console.error("Google Drive Fehler:", error);
                showStatus("Fehler bei Google Drive: " + error.message);
            }
        }
    });

    tokenClient.requestAccessToken({
        prompt: "consent"
    });
}

async function driveRequest(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            ...options.headers
        }
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || response.statusText);
    }

    return response.json();
}

async function findOrCreateMusicFolder() {
    const folderName = "MySpotify Music";

    const query = encodeURIComponent(
        `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );

    const result = await driveRequest(
        `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`
    );

    if (result.files && result.files.length > 0) {
        musicFolderId = result.files[0].id;
        return;
    }

    const folder = await driveRequest(
        "https://www.googleapis.com/drive/v3/files",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                name: folderName,
                mimeType: "application/vnd.google-apps.folder"
            })
        }
    );

    musicFolderId = folder.id;
}

async function uploadSong(file, songName) {
    if (!accessToken || !musicFolderId) {
        throw new Error("Google Drive ist nicht verbunden.");
    }

    const metadata = {
        name: file.name || songName,
        mimeType: file.type || "audio/mpeg",
        parents: [musicFolderId]
    };

    const boundary = "myspotify_upload_boundary";

    const body = new Blob([
        `--${boundary}\r\n`,
        "Content-Type: application/json; charset=UTF-8\r\n\r\n",
        JSON.stringify(metadata),
        `\r\n--${boundary}\r\n`,
        `Content-Type: ${metadata.mimeType}\r\n\r\n`,
        file,
        `\r\n--${boundary}--`
    ]);

    const response = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name",
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": `multipart/related; boundary=${boundary}`
            },
            body
        }
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || response.statusText);
    }

    return response.json();
}

async function listDriveSongs() {
    if (!accessToken || !musicFolderId) {
        throw new Error("Google Drive ist nicht verbunden.");
    }

    let allFiles = [];
    let pageToken = null;

    do {
        const parameters = new URLSearchParams({
            q: `'${musicFolderId}' in parents and trashed=false`,
            fields: "nextPageToken,files(id,name,mimeType)",
            pageSize: "100"
        });

        if (pageToken) {
            parameters.set("pageToken", pageToken);
        }

        const result = await driveRequest(
            `https://www.googleapis.com/drive/v3/files?${parameters}`
        );

        allFiles = allFiles.concat(result.files || []);
        pageToken = result.nextPageToken || null;

    } while (pageToken);

    return allFiles.filter(file =>
        /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name)
    );
}

async function downloadSong(fileId, mimeType) {
    const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
        {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        }
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || response.statusText);
    }

    const blob = await response.blob();

    return new Blob([blob], {
        type: mimeType || blob.type || "audio/mpeg"
    });
}

async function synchronizeSongs() {
    if (!accessToken || !musicFolderId) {
        throw new Error("Google Drive ist nicht verbunden.");
    }

    if (syncInProgress) {
        return;
    }

    if (!window.MySpotifyMusic) {
        showStatus("Musikverwaltung wird noch geladen. Bitte kurz warten.");
        return;
    }

    syncInProgress = true;

    try {
        showStatus("Musik wird mit Google Drive abgeglichen ...");

        // Zuerst lokale Songs hochladen, die noch nicht in Drive liegen.
        const localSongs = await window.MySpotifyMusic.getStoredSongs();

        for (const song of localSongs) {
            if (song.driveFileId) {
                continue;
            }

            const uploadedFile = await uploadSong(song.file, song.name);

            await window.MySpotifyMusic.setDriveFileId(
                song.id,
                uploadedFile.id
            );
        }

        // Danach die Songs aus Google Drive abrufen.
        const driveSongs = await listDriveSongs();

        const updatedLocalSongs =
            await window.MySpotifyMusic.getStoredSongs();

        const knownDriveIds = new Set(
            updatedLocalSongs
                .map(song => song.driveFileId)
                .filter(Boolean)
        );

        let downloadedCount = 0;

        for (const driveFile of driveSongs) {
            if (knownDriveIds.has(driveFile.id)) {
                continue;
            }

            const blob = await downloadSong(
                driveFile.id,
                driveFile.mimeType
            );

            await window.MySpotifyMusic.saveDownloadedSong({
                name: driveFile.name.replace(/\.[^/.]+$/, ""),
                file: new File(
                    [blob],
                    driveFile.name,
                    {
                        type: driveFile.mimeType || blob.type || "audio/mpeg"
                    }
                ),
                driveFileId: driveFile.id,
                addedAt: Date.now()
            });

            knownDriveIds.add(driveFile.id);
            downloadedCount++;
        }

        await window.MySpotifyMusic.refresh();

        showStatus(
            `Synchronisierung abgeschlossen. ${downloadedCount} neue Song(s) aus Google Drive geladen.`
        );

    } catch (error) {
        console.error("Synchronisierung fehlgeschlagen:", error);
        showStatus("Synchronisierung fehlgeschlagen: " + error.message);

    } finally {
        syncInProgress = false;
    }
}

if (connectButton) {
    connectButton.addEventListener("click", connectGoogleDrive);
}

window.MySpotifyDrive = {
    isConnected: () => Boolean(accessToken && musicFolderId),
    synchronizeSongs
};
