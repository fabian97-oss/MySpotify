
/**
 * Liefert einen gleichverteilten Integer im Bereich [0, maxExclusive).
 * Web Crypto wird bevorzugt; Rejection Sampling vermeidet Modulo-Bias.
 */
function secureRandomInt(maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 0x100000000) {
    throw new RangeError("maxExclusive muss eine ganze Zahl zwischen 1 und 2^32 sein.");
  }
  if (maxExclusive === 1) return 0;

  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.getRandomValues === "function") {
    const uint32Range = 0x100000000;
    const limit = Math.floor(uint32Range / maxExclusive) * maxExclusive;
    const buffer = new Uint32Array(1);
    let value;
    do {
      cryptoApi.getRandomValues(buffer);
      value = buffer[0];
    } while (value >= limit);
    return value % maxExclusive;
  }

  // Nur für Umgebungen ohne Web Crypto (z. B. ältere Testumgebungen).
  return Math.floor(Math.random() * maxExclusive);
}

/** Gleichverteilte Fisher-Yates-Permutation – keine zufällige Sortierfunktion. */
export function fisherYatesShuffle(items, randomInt = secureRandomInt) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export class MusicPlayer {
  constructor(audio, getSongById, onChange = () => {}, onQueueChange = () => {}, randomInt = secureRandomInt) {
    this.audio = audio;
    this.randomInt = randomInt;
    this.getSongById = getSongById;
    this.onChange = onChange;
    this.onQueueChange = onQueueChange;
    this.queueIds = [];
    this.sourceQueueIds = [];
    this.queueIndex = -1;
    this.currentSongId = null;
    this.shuffle = false;
    this.repeat = "off"; // off | all | one

    this.audio.addEventListener("ended", () => this.handleEnded());
  }

  get currentSong() {
    return this.currentSongId == null ? null : this.getSongById(this.currentSongId);
  }

  async playSong(song, sourceQueue = [song]) {
    if (!song) return;
    const source = sourceQueue.filter(Boolean);
    this.sourceQueueIds = [...new Set(source.map(item => item.id))];
    this.queueIds = [...this.sourceQueueIds];
    this.queueIndex = this.queueIds.indexOf(song.id);
    if (this.queueIndex < 0) {
      this.queueIds.unshift(song.id);
      this.sourceQueueIds.unshift(song.id);
      this.queueIndex = 0;
    }
    if (this.shuffle) this.applyShuffle(song.id);
    await this.playById(song.id);
    this.notifyQueue();
  }

  async playById(id) {
    const song = this.getSongById(id);
    if (!song?.url) return;
    this.currentSongId = id;
    this.queueIndex = this.queueIds.indexOf(id);
    this.audio.src = song.url;
    this.onChange(song);
    try {
      await this.audio.play();
    } catch (error) {
      this.onChange(song, error);
    }
    this.notifyQueue();
  }

  async togglePlay() {
    if (!this.currentSongId) {
      const firstId = this.queueIds[0];
      if (firstId != null && this.getSongById(firstId)) await this.playById(firstId);
      return;
    }
    if (this.audio.paused) {
      try { await this.audio.play(); }
      catch (error) { this.onChange(this.currentSong, error); }
    } else {
      this.audio.pause();
    }
  }

  async next() {
    if (!this.queueIds.length) return;
    const nextIndex = this.queueIndex + 1;
    if (nextIndex < this.queueIds.length) {
      await this.playById(this.queueIds[nextIndex]);
      return;
    }
    if (this.repeat === "all" && this.queueIds.length) {
      await this.playById(this.queueIds[0]);
      return;
    }
    this.audio.pause();
    this.audio.currentTime = 0;
    this.onChange(this.currentSong);
  }

  async previous() {
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }
    if (this.queueIndex > 0) {
      await this.playById(this.queueIds[this.queueIndex - 1]);
    } else if (this.repeat === "all" && this.queueIds.length) {
      await this.playById(this.queueIds[this.queueIds.length - 1]);
    } else {
      this.audio.currentTime = 0;
    }
  }

  async handleEnded() {
    if (this.repeat === "one" && this.currentSongId) {
      this.audio.currentTime = 0;
      try { await this.audio.play(); } catch (error) { this.onChange(this.currentSong, error); }
      return;
    }
    await this.next();
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    if (this.queueIds.length) {
      if (this.shuffle) this.applyShuffle(this.currentSongId);
      else {
        this.queueIds = [...this.sourceQueueIds];
        this.queueIndex = this.currentSongId ? this.queueIds.indexOf(this.currentSongId) : -1;
      }
    }
    this.notifyQueue();
  }

  /**
   * Startet eine ganze Playlist in einer neu gezogenen Zufallsreihenfolge.
   * sourceQueueIds behält die ursprüngliche Playlist-Reihenfolge, damit der
   * globale Shuffle-Schalter die Reihenfolge später wiederherstellen kann.
   */
  async shufflePlaylist(songs) {
    const ids = [...new Set((Array.isArray(songs) ? songs : [])
      .filter(song => song && song.id != null && this.getSongById(song.id))
      .map(song => song.id))];
    if (!ids.length) return false;

    this.sourceQueueIds = [...ids];
    this.queueIds = fisherYatesShuffle(ids, this.randomInt);
    this.shuffle = true;
    this.queueIndex = -1;

    // Den ersten zufällig gezogenen Titel sofort starten; alle übrigen folgen
    // exakt einmal in derselben zufälligen Queue-Reihenfolge.
    await this.playById(this.queueIds[0]);
    this.notifyQueue();
    return [...this.queueIds];
  }

  applyShuffle(currentId) {
    const remaining = this.sourceQueueIds.filter(id => id !== currentId);
    const shuffled = fisherYatesShuffle(remaining, this.randomInt);
    this.queueIds = currentId ? [currentId, ...shuffled] : shuffled;
    this.queueIndex = currentId ? 0 : -1;
  }

  cycleRepeat() {
    this.repeat = this.repeat === "off" ? "all" : this.repeat === "all" ? "one" : "off";
    this.notifyQueue();
    return this.repeat;
  }

  async playQueuedId(id) {
    if (!this.queueIds.includes(id)) return;
    await this.playById(id);
  }

  enqueueNext(song) {
    if (!song || this.queueIds.includes(song.id)) return false;
    if (!this.currentSongId) {
      this.queueIds.push(song.id);
      this.sourceQueueIds.push(song.id);
    } else {
      const queueInsertAt = Math.max(0, this.queueIndex + 1);
      const sourceIndex = this.sourceQueueIds.indexOf(this.currentSongId);
      const sourceInsertAt = sourceIndex >= 0 ? sourceIndex + 1 : this.sourceQueueIds.length;
      this.queueIds.splice(queueInsertAt, 0, song.id);
      this.sourceQueueIds.splice(sourceInsertAt, 0, song.id);
    }
    this.notifyQueue();
    return true;
  }

  moveQueuedSong(id, targetIndex) {
    const start = this.queueIndex < 0 ? 0 : this.queueIndex + 1;
    const upcoming = this.queueIds.slice(start);
    const oldIndex = upcoming.indexOf(id);
    if (oldIndex < 0) return false;
    const [moved] = upcoming.splice(oldIndex, 1);
    const requestedIndex = Math.max(0, Math.min(Number(targetIndex) || 0, upcoming.length + 1));
    const adjustedIndex = requestedIndex > oldIndex ? requestedIndex - 1 : requestedIndex;
    const safeIndex = Math.max(0, Math.min(adjustedIndex, upcoming.length));
    upcoming.splice(safeIndex, 0, moved);
    this.queueIds = [...this.queueIds.slice(0, start), ...upcoming];
    if (!this.shuffle) this.sourceQueueIds = [...this.queueIds];
    this.queueIndex = this.currentSongId ? this.queueIds.indexOf(this.currentSongId) : -1;
    this.notifyQueue();
    return true;
  }

  removeQueuedSong(id) {
    if (id === this.currentSongId || !this.queueIds.includes(id)) return false;
    this.queueIds = this.queueIds.filter(item => item !== id);
    this.sourceQueueIds = this.sourceQueueIds.filter(item => item !== id);
    if (this.currentSongId) this.queueIndex = this.queueIds.indexOf(this.currentSongId);
    this.notifyQueue();
    return true;
  }

  removeSong(id) {
    this.queueIds = this.queueIds.filter(item => item !== id);
    this.sourceQueueIds = this.sourceQueueIds.filter(item => item !== id);
    if (this.currentSongId === id) this.stop();
    else if (this.currentSongId) this.queueIndex = this.queueIds.indexOf(this.currentSongId);
    this.notifyQueue();
  }

  stop() {
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.currentSongId = null;
    this.queueIndex = -1;
    this.onChange(null);
    this.notifyQueue();
  }

  getUpcomingSongs(limit = 8) {
    const start = this.queueIndex < 0 ? 0 : this.queueIndex + 1;
    return this.queueIds.slice(start, start + limit)
      .map(id => this.getSongById(id)).filter(Boolean);
  }

  notifyQueue() {
    this.onQueueChange({
      shuffle: this.shuffle,
      repeat: this.repeat,
      currentSongId: this.currentSongId,
      upcoming: this.getUpcomingSongs()
    });
  }
}
