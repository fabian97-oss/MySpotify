
/* =====================================
   MYSPOTIFY - MUSIKPLAYER MIT CLOUD-SYNC
===================================== */

const audio = document.getElementById("audio-player");
const upload = document.getElementById("music-upload");
const uploadButton = document.getElementById("upload-button");

const playButton = document.getElementById("play-btn");
const previousButton = document.getElementById("previous-btn");
const nextButton = document.getElementById("next-btn");

const songList = document.getElementById("song-list");

const currentTitle = document.getElementById("current-title");
const currentArtist = document.getElementById("current-artist");

const progress = document.getElementById("progress");
const currentTime = document.getElementById("current-time");
const duration = document.getElementById("duration");
const volume = document.getElementById("volume");

const uploadStatus = document.getElementById("upload-status");

let songs = [];
let currentSongIndex = -1;
let database = null;

/* =====================================
   DATENBANK ÖFFNEN
===================================== */

function openDatabase() {
    return new Promise((resolve, reject) => {
        if (!("indexedDB" in window)) {
            reject(new Error("Dieser Browser unterstützt keine lokale Musikdatenbank."));
            return;
        }

        const request = indexedDB.open("MySpotifyDatabase", 1);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            if (!db.objectStoreNames.contains("songs")) {
                db.createObjectStore("songs", {
                    keyPath: "id",
                    autoIncrement: true
                });
            }
        };

        request.onsuccess = () => {
            database = request.result;
            resolve(database);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

/* =====================================
   SONGS AUS DER DATENBANK LADEN
===================================== */

function loadSongsFromDatabase() {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(["songs"], "readonly");
        const store = transaction.objectStore("songs");
        const request = store.getAll();

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

/* =====================================
   SONG IN DER DATENBANK SPEICHERN
===================================== */

function saveSongToDatabase(song) {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(["songs"], "readwrite");
        const store = transaction.objectStore("songs");
        const request = store.add(song);

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

/* =====================================
   SONG IN DER DATENBANK AKTUALISIEREN
===================================== */

function updateSongInDatabase(song) {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(["songs"], "readwrite");
        const store = transaction.objectStore("songs");
        const request = store.put(song);

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

/* =====================================
   ZEIT FORMATIEREN
===================================== */

function formatTime(seconds) {
    if (!Number.isFinite(seconds)) {
        return "0:00";
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

/* =====================================
   DATEIAUSWAHL ÖFFNEN
===================================== */

uploadButton.addEventListener("click", () => {
    upload.click();
});

/* =====================================
   AUSGEWÄHLTE SONGS SPEICHERN
===================================== */

upload.addEventListener("change", async (event) => {
    const files = Array.from(event.target.files);

    if (files.length === 0) {
        return;
    }

    uploadButton.disabled = true;
    uploadStatus.textContent = "Musik wird gespeichert ...";

    let savedCount = 0;

    for (const file of files) {
        const isAudio = file.type.startsWith("audio/") ||
            /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name);

        if (!isAudio) {
            continue;
        }

        try {
            await saveSongToDatabase({
                name: file.name.replace(/\.[^/.]+$/, ""),
                file: file,
                addedAt: Date.now()
            });

            savedCount++;

        } catch (error) {
            console.error("Song konnte nicht gespeichert werden:", error);
        }
    }

    upload.value = "";
    uploadButton.disabled = false;

    await refreshSongs();

    if (savedCount > 0) {
        uploadStatus.textContent =
            `${savedCount} Song(s) wurden lokal gespeichert.`;

        // Neue Songs zusätzlich mit Google Drive synchronisieren.
        if (window.MySpotifyDrive?.isConnected()) {
            await window.MySpotifyDrive.synchronizeSongs();
        }
    } else {
        uploadStatus.textContent = "Es konnten keine Songs gespeichert werden.";
    }
});

/* =====================================
   SONGS NEU LADEN
===================================== */

async function refreshSongs() {
    try {
        const storedSongs = await loadSongsFromDatabase();

        songs = storedSongs.map(song => ({
            ...song,
            url: URL.createObjectURL(song.file)
        }));

        renderSongs();

    } catch (error) {
        console.error("Songs konnten nicht geladen werden:", error);
        uploadStatus.textContent = "Fehler beim Laden deiner Musik.";
    }
}

/* =====================================
   SONGLISTE ANZEIGEN
===================================== */

function renderSongs() {
    songList.innerHTML = "";

    if (songs.length === 0) {
        songList.innerHTML = `
            <div class="empty-music">
                <span>🎶</span>
                <h3>Noch keine Musik vorhanden</h3>
                <p>Füge deine eigenen Songs hinzu.</p>
            </div>
        `;

        return;
    }

    songs.forEach((song, index) => {
        const item = document.createElement("div");

        item.className = "song-item";

        if (index === currentSongIndex) {
            item.classList.add("active");
        }

        item.innerHTML = `
            <div class="song-icon">🎵</div>

            <div class="song-item-info">
                <strong></strong>
                <span>Eigene Musik</span>
            </div>

            <span>▶</span>
        `;

        item.querySelector("strong").textContent = song.name;

        item.addEventListener("click", () => {
            playSong(index);
        });

        songList.appendChild(item);
    });
}

/* =====================================
   SONG ABSPIELEN
===================================== */

async function playSong(index) {
    if (index < 0 || index >= songs.length) {
        return;
    }

    currentSongIndex = index;

    const song = songs[index];

    audio.src = song.url;

    currentTitle.textContent = song.name;
    currentArtist.textContent = "Eigene Musik";

    renderSongs();

    try {
        await audio.play();
        playButton.textContent = "Ⅱ";
    } catch (error) {
        console.error("Wiedergabe fehlgeschlagen:", error);
        playButton.textContent = "▶";
    }
}

/* =====================================
   PLAY UND PAUSE
===================================== */

playButton.addEventListener("click", async () => {
    if (currentSongIndex === -1) {
        if (songs.length > 0) {
            await playSong(0);
        }

        return;
    }

    if (audio.paused) {
        try {
            await audio.play();
            playButton.textContent = "Ⅱ";
        } catch (error) {
            console.error("Wiedergabe fehlgeschlagen:", error);
        }
    } else {
        audio.pause();
        playButton.textContent = "▶";
    }
});

/* =====================================
   VORHERIGER SONG
===================================== */

previousButton.addEventListener("click", () => {
    if (songs.length === 0) {
        return;
    }

    if (audio.currentTime > 3) {
        audio.currentTime = 0;
        return;
    }

    const previousIndex =
        (currentSongIndex - 1 + songs.length) % songs.length;

    playSong(previousIndex);
});

/* =====================================
   NÄCHSTER SONG
===================================== */

nextButton.addEventListener("click", () => {
    if (songs.length === 0) {
        return;
    }

    const nextIndex = (currentSongIndex + 1) % songs.length;

    playSong(nextIndex);
});

/* =====================================
   AUTOMATISCH WEITER
===================================== */

audio.addEventListener("ended", () => {
    if (songs.length > 1) {
        const nextIndex = (currentSongIndex + 1) % songs.length;
        playSong(nextIndex);
    } else {
        playButton.textContent = "▶";
    }
});

/* =====================================
   FORTSCHRITT AKTUALISIEREN
===================================== */

audio.addEventListener("timeupdate", () => {
    if (!Number.isFinite(audio.duration)) {
        return;
    }

    progress.value = (audio.currentTime / audio.duration) * 100;
    currentTime.textContent = formatTime(audio.currentTime);
});

/* =====================================
   SONGDAUER ANZEIGEN
===================================== */

audio.addEventListener("loadedmetadata", () => {
    duration.textContent = formatTime(audio.duration);
    currentTime.textContent = "0:00";
    progress.value = 0;
});

/* =====================================
   FORTSCHRITTSBALKEN
===================================== */

progress.addEventListener("input", () => {
    if (Number.isFinite(audio.duration)) {
        audio.currentTime = (progress.value / 100) * audio.duration;
    }
});

/* =====================================
   LAUTSTÄRKE
===================================== */

volume.addEventListener("input", () => {
    audio.volume = Number(volume.value);
});

audio.volume = 0.7;

/* =====================================
   GOOGLE DRIVE: MUSIKFUNKTIONEN
===================================== */

window.MySpotifyMusic = {
    getStoredSongs: async () => {
        return await loadSongsFromDatabase();
    },

    setDriveFileId: async (songId, driveFileId) => {
        const storedSongs = await loadSongsFromDatabase();

        const song = storedSongs.find(item => item.id === songId);

        if (!song) {
            throw new Error("Lokaler Song wurde nicht gefunden.");
        }

        song.driveFileId = driveFileId;

        await updateSongInDatabase(song);
    },

    saveDownloadedSong: async (song) => {
        return await saveSongToDatabase(song);
    },

    refresh: async () => {
        await refreshSongs();
    }
};

/* =====================================
   GOOGLE DRIVE: VERBINDUNG ERKANNT
===================================== */

window.addEventListener("myspotify-drive-connected", async () => {
    if (!database) {
        uploadStatus.textContent =
            "Musikdatenbank wird noch geladen. Bitte gleich erneut verbinden.";

        return;
    }

    await window.MySpotifyDrive.synchronizeSongs();
});

/* =====================================
   APP STARTEN
===================================== */

async function initializeApp() {
    try {
        uploadStatus.textContent = "Gespeicherte Musik wird geladen ...";

        await openDatabase();
        await refreshSongs();

        uploadStatus.textContent = songs.length > 0
            ? `${songs.length} gespeicherte Songs geladen.`
            : "Deine Musik wird automatisch gespeichert.";

    } catch (error) {
        console.error("Datenbankfehler:", error);

        uploadStatus.textContent =
            "Die Musikdatenbank konnte nicht geöffnet werden. Bitte nutze einen aktuellen Browser.";

        uploadButton.disabled = true;
    }
}

initializeApp();

/* Beim Verlassen temporäre Audio-Adressen freigeben */

window.addEventListener("beforeunload", () => {
    songs.forEach(song => URL.revokeObjectURL(song.url));
});
