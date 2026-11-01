
const GOOGLE_CLIENT_ID = "549476284025-chhtts628n343481h3ipoomikrkmem2q.apps.googleusercontent.com";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

let accessToken = null;
let musicFolderId = null;
let tokenClient = null;

const connectButton = document.getElementById("google-connect-button");
const statusElement = document.getElementById("upload-status");

function showStatus(message) {
    statusElement.textContent = message;
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

                showStatus("Google Drive ist erfolgreich verbunden! ☁️");
                connectButton.textContent = "Google Drive verbunden";
                connectButton.disabled = true;

            } catch (error) {
                console.error(error);
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

connectButton.addEventListener("click", connectGoogleDrive);

// Zugriff für die späteren Synchronisierungsfunktionen vorbereiten.
window.MySpotifyDrive = {
    getAccessToken: () => accessToken,
    getMusicFolderId: () => musicFolderId
};
