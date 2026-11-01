export class MusicPlayer {
  constructor(audio, getSongById, onChange = () => {}, onQueueChange = () => {}) {
    this.audio = audio;
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

  applyShuffle(currentId) {
    const remaining = this.sourceQueueIds.filter(id => id !== currentId);
    for (let i = remaining.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
    }
    this.queueIds = currentId ? [currentId, ...remaining] : remaining;
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
