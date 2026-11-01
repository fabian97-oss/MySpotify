const EMPTY_METADATA = {
  version: 2,
  favorites: [],
  favoriteStates: {},
  playlists: [],
  deletedPlaylistIds: {},
  songCovers: {},
  coverStates: {},
  deletedSongIds: [],
  updatedAt: 0
};

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const uniqueStrings = values => [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === "string" && value.length))];

function stateIsNewer(candidate, current) {
  if (!current) return true;
  const candidateTime = Number(candidate?.updatedAt) || 0;
  const currentTime = Number(current?.updatedAt) || 0;
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  return String(candidate?.deviceId || "") > String(current?.deviceId || "");
}

function normalizeStateMap(value, fallbackValue) {
  const result = {};
  if (!isObject(value)) return result;
  for (const [key, state] of Object.entries(value)) {
    if (!key || !isObject(state)) continue;
    result[key] = {
      value: Object.hasOwn(state, "value") ? state.value : fallbackValue,
      updatedAt: Number(state.updatedAt) || 0,
      deviceId: typeof state.deviceId === "string" ? state.deviceId : "legacy"
    };
  }
  return result;
}

export function normalizeMetadata(input) {
  const value = isObject(input) ? input : {};
  const favoriteStates = normalizeStateMap(value.favoriteStates, false);
  for (const key of uniqueStrings(value.favorites)) {
    if (!favoriteStates[key]) favoriteStates[key] = {value: true, updatedAt: 0, deviceId: "legacy"};
  }

  const coverStates = normalizeStateMap(value.coverStates, null);
  if (isObject(value.songCovers)) {
    for (const [key, cover] of Object.entries(value.songCovers)) {
      if (typeof cover === "string" && !coverStates[key]) {
        coverStates[key] = {value: cover, updatedAt: 0, deviceId: "legacy"};
      }
    }
  }

  const playlists = (Array.isArray(value.playlists) ? value.playlists : [])
    .filter(item => isObject(item) && typeof item.id === "string")
    .map(item => ({
      id: item.id,
      name: String(item.name || "Unbenannte Playlist").slice(0, 100),
      songIds: uniqueStrings(item.songIds),
      cover: typeof item.cover === "string" ? item.cover : null,
      updatedAt: Number(item.updatedAt) || 0,
      deviceId: typeof item.deviceId === "string" ? item.deviceId : "legacy"
    }));

  let deletedPlaylistIds = {};
  if (isObject(value.deletedPlaylistIds)) {
    for (const [id, state] of Object.entries(value.deletedPlaylistIds)) {
      if (!id) continue;
      deletedPlaylistIds[id] = isObject(state)
        ? {deletedAt: Number(state.deletedAt) || 0, deviceId: String(state.deviceId || "legacy")}
        : {deletedAt: Number(state) || 0, deviceId: "legacy"};
    }
  } else if (Array.isArray(value.deletedPlaylistIds)) {
    for (const id of uniqueStrings(value.deletedPlaylistIds)) deletedPlaylistIds[id] = {deletedAt: 0, deviceId: "legacy"};
  }

  const normalized = {
    ...EMPTY_METADATA,
    favoriteStates,
    coverStates,
    playlists,
    deletedPlaylistIds,
    deletedSongIds: uniqueStrings(value.deletedSongIds),
    updatedAt: Number(value.updatedAt) || 0
  };
  normalized.favorites = Object.entries(favoriteStates).filter(([, state]) => state.value === true).map(([key]) => key);
  normalized.songCovers = Object.fromEntries(Object.entries(coverStates).filter(([, state]) => typeof state.value === "string" && state.value.length).map(([key, state]) => [key, state.value]));
  return normalized;
}

export function mergeMetadata(left, right) {
  const a = normalizeMetadata(left);
  const b = normalizeMetadata(right);

  const favoriteStates = {...a.favoriteStates};
  for (const [key, state] of Object.entries(b.favoriteStates)) {
    if (stateIsNewer(state, favoriteStates[key])) favoriteStates[key] = state;
  }

  const coverStates = {...a.coverStates};
  for (const [key, state] of Object.entries(b.coverStates)) {
    if (stateIsNewer(state, coverStates[key])) coverStates[key] = state;
  }

  const playlistMap = new Map(a.playlists.map(playlist => [playlist.id, playlist]));
  for (const playlist of b.playlists) {
    const current = playlistMap.get(playlist.id);
    if (stateIsNewer(playlist, current)) playlistMap.set(playlist.id, playlist);
  }

  const deletedPlaylistIds = {...a.deletedPlaylistIds};
  for (const [id, state] of Object.entries(b.deletedPlaylistIds)) {
    const current = deletedPlaylistIds[id];
    if (!current || state.deletedAt > current.deletedAt || (state.deletedAt === current.deletedAt && state.deviceId > current.deviceId)) {
      deletedPlaylistIds[id] = state;
    }
  }

  const playlists = [...playlistMap.values()].filter(playlist => {
    const tombstone = deletedPlaylistIds[playlist.id];
    return !tombstone || playlist.updatedAt > tombstone.deletedAt;
  });

  const merged = {
    version: 2,
    favoriteStates,
    favorites: Object.entries(favoriteStates).filter(([, state]) => state.value === true).map(([key]) => key),
    coverStates,
    songCovers: Object.fromEntries(Object.entries(coverStates).filter(([, state]) => typeof state.value === "string" && state.value.length).map(([key, state]) => [key, state.value])),
    playlists,
    deletedPlaylistIds,
    deletedSongIds: uniqueStrings([...a.deletedSongIds, ...b.deletedSongIds]),
    updatedAt: Math.max(a.updatedAt, b.updatedAt, Date.now())
  };
  return merged;
}

export function migrateSongMetadata(metadata, oldKey, newKey, deviceId) {
  if (!oldKey || !newKey || oldKey === newKey) return normalizeMetadata(metadata);
  const next = normalizeMetadata(metadata);
  const now = Date.now();

  if (next.favoriteStates[oldKey]) {
    const oldState = next.favoriteStates[oldKey];
    const candidate = {...oldState, updatedAt: now, deviceId};
    if (stateIsNewer(candidate, next.favoriteStates[newKey])) next.favoriteStates[newKey] = candidate;
    delete next.favoriteStates[oldKey];
  }
  if (next.coverStates[oldKey]) {
    const oldState = next.coverStates[oldKey];
    const candidate = {...oldState, updatedAt: now, deviceId};
    if (stateIsNewer(candidate, next.coverStates[newKey])) next.coverStates[newKey] = candidate;
    delete next.coverStates[oldKey];
  }
  next.playlists = next.playlists.map(playlist => ({
    ...playlist,
    songIds: uniqueStrings(playlist.songIds.map(id => id === oldKey ? newKey : id)),
    updatedAt: now,
    deviceId
  }));
  next.favorites = Object.entries(next.favoriteStates).filter(([, state]) => state.value === true).map(([key]) => key);
  next.songCovers = Object.fromEntries(Object.entries(next.coverStates).filter(([, state]) => typeof state.value === "string" && state.value.length).map(([key, state]) => [key, state.value]));
  next.updatedAt = now;
  return next;
}

export function setFavoriteState(metadata, key, favorite, deviceId) {
  const next = normalizeMetadata(metadata);
  next.favoriteStates[key] = {value: Boolean(favorite), updatedAt: Date.now(), deviceId};
  next.favorites = Object.entries(next.favoriteStates).filter(([, state]) => state.value === true).map(([id]) => id);
  next.updatedAt = Date.now();
  return next;
}

export function setCoverState(metadata, key, cover, deviceId) {
  const next = normalizeMetadata(metadata);
  next.coverStates[key] = {value: typeof cover === "string" ? cover : null, updatedAt: Date.now(), deviceId};
  next.songCovers = Object.fromEntries(Object.entries(next.coverStates).filter(([, state]) => typeof state.value === "string" && state.value.length).map(([id, state]) => [id, state.value]));
  next.updatedAt = Date.now();
  return next;
}
