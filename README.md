# MySpotify

Eine persönliche Musikbibliothek als installierbare Progressive Web App (PWA). Die Songs werden lokal im Browser in IndexedDB gespeichert. Optional kann dieselbe Bibliothek über Google Drive zwischen eigenen Geräten synchronisiert werden.

## Funktionen

- Musikdateien lokal importieren und offline abspielen
- Playlists erstellen, umbenennen, mit Cover versehen und löschen
- Favoriten und eigene Song-/Playlist-Cover
- Suche nach Songtiteln und Playlists
- Sortierung nach Titel, neuestem oder ältestem Import
- Wiedergabewarteschlange mit „Als Nächstes“, Drag-and-drop-Sortierung und Entfernen einzelner Queue-Einträge
- Zufallswiedergabe, Wiederholung der Warteschlange und Wiederholung eines einzelnen Songs
- Lautstärke, Fortschrittsanzeige und Tastatursteuerung
- IndexedDB mit Transaktionsabschluss, Schema-Versionierung und Song-Indizes
- Optionaler Google-Drive-Abgleich mit Seiten-Paginierung und resumable Uploads
- Offline-App-Shell über einen versionierten Service Worker

## Starten

Die App muss über `localhost` oder eine HTTPS-Adresse geöffnet werden. `file://` funktioniert wegen ES-Modulen, IndexedDB und Service Worker nicht zuverlässig.

Beispiel mit Python:

```bash
python -m http.server 8000
```

Danach im Browser öffnen:

```text
http://localhost:8000
```

Die mitgelieferten Logiktests kannst du mit Node.js ausführen:

```bash
npm test
```

Für die dauerhafte Nutzung kannst du den Ordner auf einem statischen HTTPS-Host bereitstellen und die Seite über „Zum Startbildschirm hinzufügen“ installieren.

## Google Drive konfigurieren

Die Datei `js/google-drive.js` enthält die Google OAuth Client-ID des ursprünglichen Projekts. Falls du eine andere Google-Cloud-Konfiguration nutzt, passe `GOOGLE_CLIENT_ID` dort an.

In der Google Cloud Console:

1. Aktiviere die Google Drive API.
2. Richte einen OAuth-Client vom Typ „Webanwendung“ ein.
3. Trage die genutzten Ursprünge als autorisierte JavaScript-Ursprünge ein, zum Beispiel `http://localhost:8000` und deine HTTPS-Domain.
4. Verwende die OAuth-Client-ID in `js/google-drive.js`.
5. Veröffentliche bzw. konfiguriere den OAuth-Zustimmungsbildschirm passend zu deinem Google-Konto.

Es wird ausschließlich der Scope `drive.file` angefordert. Ein Client Secret gehört nicht in diese Frontend-Anwendung. Beschränke den OAuth-Client in der Google Cloud Console auf die tatsächlich verwendeten Ursprünge.

## GitHub Pages: Fehlerbehebung

### Service Worker meldet „Unexpected token ':'“

Öffne die Datei `sw.js` direkt im Browser. Bei einer Projektseite muss die URL beispielsweise so aussehen: `https://BENUTZER.github.io/REPOSITORY/sw.js`. Es muss der JavaScript-Quelltext erscheinen, keine GitHub-404-Seite und kein JSON. `index.html` und `sw.js` müssen im selben veröffentlichten Ordner liegen. Wenn GitHub Pages aus `/docs` veröffentlicht, müssen beide Dateien dort liegen. Nach dem Push ggf. mit `Strg` + `F5` neu laden und unter den DevTools → Application → Service Workers eine alte fehlerhafte Registrierung entfernen.

### Google Drive öffnet kein Anmeldefenster

In der Google Cloud Console beim verwendeten OAuth-Client vom Typ „Webanwendung“ unter **Autorisierte JavaScript-Ursprünge** den Ursprung der Website eintragen. Bei GitHub-Pages-Projektseiten ist das z. B. `https://BENUTZER.github.io` – **ohne** `/REPOSITORY/`-Pfad. Bei einer eigenen Domain muss stattdessen deren `https://`-Ursprung eingetragen werden. Google verlangt eine genaue Übereinstimmung von Schema, Host und ggf. Port; Pfade sind bei JavaScript-Ursprüngen nicht zulässig. Falls der OAuth-Zustimmungsbildschirm auf „Extern / Test“ steht, muss dein Google-Konto als Testnutzer eingetragen sein.

Der Drive-Button zeigt den aktuellen Fehler jetzt direkt unter den Import-Schaltflächen an. Bei einem OAuth-Origin-Problem enthält die Meldung einen passenden Hinweis.

## Synchronisierung und Datenmodell

Die lokale Bibliothek bleibt die Arbeitskopie. Favoriten, Cover und Playlists besitzen Änderungszeitpunkte und Gerätekennungen. Änderungen werden mit dem Cloud-Stand zusammengeführt, anstatt die lokale Metadaten-Datei blind zu überschreiben. Löschungen werden als Tombstones gespeichert, damit entfernte Cloud-Songs nicht bei jedem Abgleich wieder auftauchen. Die Auflistung von Drive-Dateien verarbeitet alle `nextPageToken`-Seiten. Datei-Uploads nutzen die resumable-upload-API mit 8-MiB-Blöcken und Wiederaufnahme nach temporären Verbindungsfehlern.

Die Zusammenführung ist für die private Nutzung über mehrere eigene Geräte gedacht. Bei zwei nahezu gleichzeitigen Änderungen derselben Playlist gewinnt der neuere Zeitstempel; bei identischen Zeitstempeln entscheidet die Gerätekennung. Unterschiedlich eingestellte Geräteuhren können die Konfliktauflösung beeinflussen. Es handelt sich nicht um ein transaktionales Mehrbenutzersystem.

## Perspektive: bis zu etwa 10 Freunde

Die aktuelle Version ist weiterhin eine persönliche App. Sie bietet **noch keine getrennten Benutzerkonten, Rollen, Einladungen oder eine isolierte Bibliothek pro Person**. Ein gemeinsam genutzter Google-Drive-Ordner allein ist keine saubere Benutzerverwaltung.

Für einen späteren Freundeskreis empfehle ich eine kleine Backend-Erweiterung:

- Benutzeranmeldung (z. B. Authentifizierungsanbieter)
- Bibliothek und Playlists mit `ownerId` bzw. `libraryId`
- explizite Einladungen und Rollen (Owner/Member)
- serverseitig verwaltete Synchronisierung und Änderungsjournal
- Zugriffskontrollen für jede Datei und jede Bibliotheksaktion

Bis dahin sollte jeder Nutzer seine eigene MySpotify-Instanz bzw. sein eigenes Google Drive verwenden. Teile keine OAuth-Zugangsdaten zwischen Freunden.

## Daten, Speicher und Backups

- Musikdateien und Metadaten liegen im Browserprofil des jeweiligen Geräts. Browserdaten löschen oder ein anderes Browserprofil verwenden kann lokale Daten entfernen.
- Google Drive synchronisiert Musikdateien und Metadaten, wenn du es verbindest.
- Vor größeren Änderungen empfiehlt sich ein zusätzliches Backup deiner Musikdateien.
- Der Google-Zugriffstoken liegt nur im Arbeitsspeicher der Seite und wird nicht dauerhaft in IndexedDB gespeichert. Nach Ablauf kann eine erneute Verbindung nötig sein.

## Hinweise

- Browser unterstützen nicht alle Audioformate gleich. MP3 und AAC/MP4 sind meist am breitesten verfügbar; FLAC/WMA/AIFF-Unterstützung hängt vom Browser und Betriebssystem ab.
- Sehr große Bibliotheken benötigen entsprechend Browser-Speicher und Upload-/Download-Zeit.
- Die App wurde ohne Build-Schritt umgesetzt und verwendet native JavaScript-ES-Module.


## GitHub-Update (bitte genau so übernehmen)

Dieses ZIP ist absichtlich **ohne zusätzlichen Projekt-Unterordner** gepackt. Entpacke den ZIP-Inhalt direkt in den Repository-Hauptordner `fabian97-oss/MySpotify` und überschreibe die vorhandenen Dateien. Danach müssen `index.html`, `manifest.json`, `sw.js`, `style.css` und die Ordner `js/` sowie `assets/` direkt im Repository-Hauptordner liegen. Insbesondere den gesamten Ordner `js/` ersetzen: `js/app.js` ist der App-Einstiegspunkt und importiert `js/google-drive.js`; `js/metadata.js` enthält nur Metadaten-Hilfsfunktionen und darf nicht als `app.js` gespeichert werden.

Für GitHub Pages mit der Adresse `https://fabian97-oss.github.io/MySpotify/` muss als autorisierter JavaScript-Ursprung in Google Cloud exakt `https://fabian97-oss.github.io` eingetragen sein (ohne `/MySpotify/`). Außerdem muss die Google Drive API aktiviert sein. Falls der OAuth-Zustimmungsbildschirm den Veröffentlichungsstatus „Test“ hat, muss das verwendete Google-Konto bei den Testnutzern stehen.


## Google Drive auf GitHub Pages zuverlässig aktivieren

1. In Google Cloud ein OAuth-Client vom Typ **Webanwendung** verwenden. Die Client-ID steht in `js/google-drive.js`; ein Client Secret wird im Browser **nicht** benötigt und darf dort nicht eingetragen werden.
2. Die Google Drive API im selben Google-Cloud-Projekt aktivieren.
3. Unter Google Auth Platform → Clients → OAuth-Webclient bei **Autorisierte JavaScript-Ursprünge** exakt `https://fabian97-oss.github.io` eintragen. Nicht `https://fabian97-oss.github.io/MySpotify/` (Pfad/Slash weglassen). Für lokalen Test zusätzlich `http://localhost:8000` eintragen.
4. Falls der OAuth-Zustimmungsbildschirm im Testmodus ist, das Google-Konto als Testnutzer hinzufügen.
5. Die Website unter `https://fabian97-oss.github.io/MySpotify/` öffnen. Unter dem Drive-Button muss zuerst „Google-Anmeldung bereit“ erscheinen. Erst dann verbinden.

### Fehlerdiagnose

Unter dem Drive-Button wird der Ladezustand des Google-Anmeldescripts angezeigt. Wenn das App-Modul nicht lädt, meldet ein Fallback dies beim Klick ausdrücklich. In der Browserkonsole liefert `MySpotifyDrive.getDiagnostics()` den Zustand von Button-Handler, Google-Script, OAuth-Client und aktuellem Ursprung.

Google Identity Services wird beim App-Start geladen und nicht erst nach dem Klick. Der eigentliche `requestAccessToken()`-Aufruf erfolgt synchron im Klick-Handler, damit der Browser das Anmelde-Popup als direkte Nutzeraktion behandelt.


## GitHub-Pages-Diagnose (Version 2.2.2)

Nach dem Push zuerst `https://fabian97-oss.github.io/MySpotify/diagnose.html` öffnen.
Die Seite prüft HTTP-Status, MIME-Typ und Dateiinhalte für Index, Manifest, Service Worker und alle JavaScript-Module.
Der App-Start verwendet einen abgefangenen dynamischen Import und zeigt Modul-/MIME-/404-Fehler direkt unter dem Drive-Button.
In der Konsole sind zusätzlich `window.MySpotifyBoot` und nach erfolgreichem Start `MySpotifyDrive.getDiagnostics()` verfügbar.


## Version 2.2.2 – Startfehler behoben

- Initialisiert `currentView` mit `all` und `activePlaylistId` mit `null`, bevor der erste Bibliotheks-Render ausgeführt wird.
- Übergibt `getStoredSongs()` an das Google-Drive-Modul; die Funktion wartet auf die abgeschlossene App-/IndexedDB-Initialisierung und liest dann die Songs.
- Aktualisiert Modul-Cache-Buster und Service-Worker-Cache, damit GitHub Pages nicht mehr die fehlerhafte 2.2.1-Version wiederverwendet.


## Version 2.2.2 – Startfehlerkorrektur

- Initialisiert `currentView` und `activePlaylistId` vor dem ersten Rendering.
- Stellt `getStoredSongs()` als asynchronen IndexedDB-Zugriff für den Drive-Abgleich bereit.
- Der App-Bootstrap wartet jetzt auch auf die abgeschlossene IndexedDB-Initialisierung und das Binden der UI-Events, bevor er die App als bereit meldet.
- Es werden keine IndexedDB-Daten gelöscht oder migriert; vorhandene lokale Songs bleiben unverändert.
