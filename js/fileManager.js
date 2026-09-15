/**
 * Musico - File Manager & Local Storage (IndexedDB)
 * High-Speed, Virtualization-Ready, and Alphabetically Sorted (Special -> Numbers -> A-Z)
 * Mobile-Optimized: Memory-safe file selection and non-blocking streaming.
 */

class FileManager {
  constructor() {
    this.db = null;
    this.dbName = 'MusicoDB';
    this.dbVersion = 2;
    this.initDB();
  }

  /**
   * Universal Song Sorting:
   * 1. Special characters / symbols (#, @, _, -, etc.)
   * 2. Numbers (0-9, 01, 100, etc.)
   * 3. A-Z Alphabetical order (case-insensitive)
   */
  static getSortCategory(str) {
    if (!str) return 1;
    const ch = str.trim().charAt(0);
    if (/^[A-Za-z]/i.test(ch)) return 3; // Alphabetical
    if (/^[0-9]/.test(ch)) return 2; // Numbers
    return 1; // Special Characters / Symbols
  }

  static compareTracks(a, b) {
    const titleA = (a.title || a.name || '').trim();
    const titleB = (b.title || b.name || '').trim();
    const catA = FileManager.getSortCategory(titleA);
    const catB = FileManager.getSortCategory(titleB);

    if (catA !== catB) {
      return catA - catB;
    }

    return titleA.localeCompare(titleB, undefined, { numeric: true, sensitivity: 'base' });
  }

  static sortTracks(tracks) {
    if (!tracks || tracks.length === 0) return tracks;
    return tracks.sort(FileManager.compareTracks);
  }

  /**
   * Initialize IndexedDB database
   */
  async initDB() {
    return new Promise((resolve) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('tracks')) {
          const trackStore = db.createObjectStore('tracks', { keyPath: 'id' });
          trackStore.createIndex('title', 'title', { unique: false });
          trackStore.createIndex('artist', 'artist', { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('playlists')) {
          const playlistStore = db.createObjectStore('playlists', { keyPath: 'id' });
          playlistStore.createIndex('name', 'name', { unique: false });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };

      request.onerror = (e) => {
        console.warn('IndexedDB initialization error:', e);
        resolve(null);
      };
    });
  }

  /**
   * Universal audio file validation
   * Accepts standard audio extensions, MIME types, and MP3 variations (audio/mpeg, audio/mp3, etc.)
   */
  static isAudioFile(file) {
    if (!file) return false;
    const name = (file.name || '').trim();
    const type = (file.type || '').toLowerCase().trim();

    // 1. Audio extensions (case-insensitive)
    if (/\.(mp3|wav|ogg|oga|flac|m4a|aac|opus|weba|webm|m4b|mpga|wma|aiff|alac)$/i.test(name)) {
      return true;
    }

    // 2. Standard MIME types
    if (type.startsWith('audio/')) {
      return true;
    }

    // 3. Known audio MIME variations
    const audioMimes = [
      'audio/mpeg', 'audio/mp3', 'audio/x-mp3', 'audio/x-mpeg', 'audio/mp4',
      'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/x-flac',
      'audio/ogg', 'audio/x-m4a', 'audio/m4a', 'audio/opus', 'audio/webm',
      'application/ogg', 'application/x-ogg'
    ];
    if (audioMimes.some(m => type === m || type.includes(m))) {
      return true;
    }

    // 4. Fallback: file has audio extension even if browser reports generic MIME
    if (name.includes('.') && /\.(mp3|wav|ogg|flac|m4a|aac|opus|weba|webm|m4b|mpga)$/i.test(name)) {
      return true;
    }

    return false;
  }

  /**
   * Select audio files or folders using Modern File System Access API with Progressive Loading
   * Supports single .mp3 files, multiple .mp3 files, and folders
   * @param {Object} options Optional callbacks: onScanStart, onInitialTracksReady, onProgress, onBatchMetadataUpdated
   */
  async selectDirectory(options = {}) {
    const isMobile = window.innerWidth <= 900 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    
    // On PC: Use modern showOpenFilePicker for selecting single or multiple audio files
    if (!isMobile && 'showOpenFilePicker' in window) {
      try {
        if (options.onScanStart) options.onScanStart();
        const fileHandles = await window.showOpenFilePicker({
          multiple: true,
          types: [
            {
              description: 'Audio Files (*.mp3, *.wav, *.flac, *.m4a, *.aac, *.ogg, *.opus)',
              accept: {
                'audio/*': ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.weba', '.webm', '.m4b', '.mpga'],
                'audio/mpeg': ['.mp3', '.mpga'],
                'audio/mp3': ['.mp3'],
                'audio/x-mp3': ['.mp3'],
                'audio/x-mpeg': ['.mp3'],
                'audio/mp4': ['.m4a', '.m4b'],
                'audio/aac': ['.aac'],
                'audio/wav': ['.wav'],
                'audio/x-wav': ['.wav'],
                'audio/flac': ['.flac'],
                'audio/x-flac': ['.flac'],
                'audio/ogg': ['.ogg', '.opus'],
                'audio/webm': ['.weba', '.webm']
              }
            }
          ]
        });

        if (fileHandles && fileHandles.length > 0) {
          const files = await Promise.all(fileHandles.map(h => h.getFile()));
          const validAudioFiles = files.filter(f => FileManager.isAudioFile(f));
          return await this.processAudioFiles(validAudioFiles, options);
        }
        return [];
      } catch (err) {
        if (err.name === 'AbortError') return [];
        console.warn('showOpenFilePicker error/fallback:', err);
      }
    }

    // Fallback & Mobile: Memory-safe audio file input
    return this.triggerDirectoryInput(options);
  }

  /**
   * Recursively scan FileSystemDirectoryHandle (PC)
   */
  async scanDirectoryHandle(dirHandle, fileList) {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file') {
        if (FileManager.isAudioFile(entry) || /\.(mp3|wav|ogg|flac|m4a|aac|opus|weba|webm|m4b|mpga)$/i.test(entry.name)) {
          try {
            const file = await entry.getFile();
            if (FileManager.isAudioFile(file)) {
              fileList.push(file);
            }
          } catch (e) {
            console.warn('Could not read file:', entry.name, e);
          }
        }
      } else if (entry.kind === 'directory') {
        try {
          await this.scanDirectoryHandle(entry, fileList);
        } catch (e) {
          console.warn('Could not read subfolder:', entry.name, e);
        }
      }
    }
  }

  /**
   * Fallback & Mobile Input: Trigger memory-safe file selection
   */
  triggerDirectoryInput(options = {}) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = 'audio/*,audio/mpeg,audio/mp3,audio/x-mp3,audio/x-mpeg,audio/mp4,audio/aac,audio/wav,audio/x-wav,audio/flac,audio/x-flac,audio/ogg,audio/x-m4a,audio/m4a,audio/opus,audio/webm,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.weba,.webm,.m4b,.mpga';

      input.onchange = async (e) => {
        if (options.onScanStart) options.onScanStart();
        const rawFiles = e.target.files ? Array.from(e.target.files) : [];
        const files = rawFiles.filter(f => FileManager.isAudioFile(f));
        const tracks = await this.processAudioFiles(files, options);
        resolve(tracks);
      };

      input.click();
    });
  }

  /**
   * Fast lightweight key lookup to avoid reading large Blobs into RAM during scan
   */
  async getExistingTrackKeys() {
    if (!this.db) await this.initDB();
    if (!this.db) return new Map();

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('tracks', 'readonly');
        const store = tx.objectStore('tracks');
        const req = store.openCursor();
        const map = new Map();

        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const val = cursor.value;
            const key = `${val.fileBlob?.name || val.title}_${val.fileBlob?.size || 0}`;
            map.set(key, val);
            cursor.continue();
          } else {
            resolve(map);
          }
        };
        req.onerror = () => resolve(new Map());
      } catch (e) {
        resolve(new Map());
      }
    });
  }

  /**
   * High-Speed & Low-Memory Audio Files Processing
   * 1. Smart Re-import: matches files against existing IndexedDB records instantly.
   * 2. Sorts immediately (Special -> Numbers -> A-Z).
   * 3. Prioritizes visible screen tracks first.
   * 4. Parallel background batch parsing and bulk DB writes.
   */
  async processAudioFiles(files, options = {}) {
    if (!files || files.length === 0) return [];

    const total = files.length;
    const initialTracks = [];
    const timestamp = Date.now();

    // 1. Build fast lookup map without loading heavy audio data
    const existingMap = await this.getExistingTrackKeys();
    const unparsedTracks = [];

    // Phase 1: Rapid track generation & smart reuse (<30ms)
    for (let i = 0; i < total; i++) {
      const file = files[i];
      const key = `${file.name}_${file.size}`;
      const cached = existingMap.get(key);

      if (cached) {
        // SMART REUSE: Track is already parsed and in DB -> Re-attach fresh File reference
        cached.fileBlob = file;
        cached.audioUrl = null;
        if (cached.coverBlob && !cached.coverUrl) {
          cached.coverUrl = URL.createObjectURL(cached.coverBlob);
        }
        initialTracks.push(cached);
      } else {
        // New track needing fast metadata extraction
        const id = 'local_' + timestamp + '_' + i + '_' + Math.random().toString(36).substr(2, 6);
        const cleanName = file.name.replace(/\.[^/.]+$/, '');
        let artist = 'Unknown';
        let title = cleanName;

        if (cleanName.includes(' - ')) {
          const parts = cleanName.split(' - ');
          artist = parts[0].trim() || 'Unknown';
          title = parts.slice(1).join(' - ').trim() || cleanName;
        }

        const newTrack = {
          id: id,
          title: title,
          artist: artist,
          album: 'Unknown Album',
          year: '',
          lyrics: '',
          duration: 0,
          formattedDuration: '0:00',
          coverUrl: 'assets/M logo for music items.png',
          coverBlob: null,
          hasEmbeddedCover: false,
          fileBlob: file,
          audioUrl: null,
          isLocal: true,
          addedAt: timestamp + i
        };

        initialTracks.push(newTrack);
        unparsedTracks.push(newTrack);
      }
    }

    // Sort songs immediately: Special Characters -> Numbers -> A-Z
    FileManager.sortTracks(initialTracks);

    // Immediately render sorted songs in the UI
    if (options.onInitialTracksReady) {
      options.onInitialTracksReady(initialTracks);
    }

    // Phase 2: Prioritize visible tracks, then process remaining in controlled batches
    const isMobile = window.innerWidth <= 900 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const BATCH_SIZE = isMobile ? 6 : 24;
    const DB_BATCH_SIZE = isMobile ? 25 : 80;

    let processedCount = total - unparsedTracks.length;
    let pendingDBSave = [];

    if (options.onProgress) {
      const percent = Math.min(100, Math.round((processedCount / total) * 100));
      options.onProgress({ processed: processedCount, total, remaining: unparsedTracks.length, percent });
    }

    // Sort unparsed tracks to match visible order
    FileManager.sortTracks(unparsedTracks);

    for (let i = 0; i < unparsedTracks.length; i += BATCH_SIZE) {
      const chunk = unparsedTracks.slice(i, i + BATCH_SIZE);
      const updatedChunk = [];

      await Promise.all(chunk.map(async (track) => {
        try {
          const meta = await ID3Parser.parse(track.fileBlob);
          if (meta) {
            if (meta.title && meta.title !== 'Unknown Track') track.title = meta.title;
            if (meta.artist && meta.artist !== 'Unknown') track.artist = meta.artist;
            if (meta.album && meta.album !== 'Unknown Album') track.album = meta.album;
            if (meta.year) track.year = meta.year;
            if (meta.lyrics) track.lyrics = meta.lyrics;
            if (meta.coverBlob) {
              track.coverBlob = meta.coverBlob;
              track.coverUrl = meta.coverUrl || URL.createObjectURL(meta.coverBlob);
              track.hasEmbeddedCover = true;
            }
          }
        } catch (err) {
          // Gracefully retain filename fallback
        }

        processedCount++;
        pendingDBSave.push(track);
        updatedChunk.push(track);
      }));

      // Report progressive progress
      const remaining = total - processedCount;
      const percent = Math.min(100, Math.round((processedCount / total) * 100));

      if (options.onProgress) {
        options.onProgress({ processed: processedCount, total, remaining, percent });
      }

      if (options.onBatchMetadataUpdated) {
        options.onBatchMetadataUpdated(updatedChunk);
      }

      // Save to IndexedDB in bulk transactions
      if (pendingDBSave.length >= DB_BATCH_SIZE || i + BATCH_SIZE >= unparsedTracks.length) {
        await this.saveTracksBatchToDB(pendingDBSave);
        pendingDBSave = [];
      }

      // Micro-task yield to main thread so animations and scrolling stay fluid
      await new Promise(r => setTimeout(r, isMobile ? 15 : 0));
    }

    if (pendingDBSave.length > 0) {
      await this.saveTracksBatchToDB(pendingDBSave);
    }

    if (options.onProgress) {
      options.onProgress({ processed: total, total, remaining: 0, percent: 100 });
    }

    return initialTracks;
  }

  /**
   * Bulk Batch Save tracks to IndexedDB
   */
  async saveTracksBatchToDB(tracks) {
    if (!this.db) await this.initDB();
    if (!this.db || !tracks || tracks.length === 0) return;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('tracks', 'readwrite');
        const store = tx.objectStore('tracks');
        for (let i = 0; i < tracks.length; i++) {
          store.put(tracks[i]);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (e) {
        console.warn('Batch DB save error:', e);
        resolve();
      }
    });
  }

  /**
   * Save single track to IndexedDB
   */
  async saveTrackToDB(track) {
    return this.saveTracksBatchToDB([track]);
  }

  /**
   * Fast Load stored tracks from IndexedDB with persistent cover artwork restoration & sorting
   */
  async loadStoredTracks() {
    if (!this.db) await this.initDB();
    if (!this.db) return [];

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('tracks', 'readonly');
        const store = tx.objectStore('tracks');
        const req = store.getAll();

        req.onsuccess = () => {
          const tracks = req.result || [];
          for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            track.audioUrl = null; // Lazy loaded on demand by player to conserve RAM

            track.lyrics = track.lyrics || '';
            // Recreate cover art object URL from stored compressed coverBlob
            if (track.coverBlob) {
              track.coverUrl = URL.createObjectURL(track.coverBlob);
              track.hasEmbeddedCover = true;
            } else {
              track.coverUrl = 'assets/M logo for music items.png';
              track.hasEmbeddedCover = false;
            }
          }
          // Ensure stored tracks are returned in sorted order
          FileManager.sortTracks(tracks);
          resolve(tracks);
        };

        req.onerror = () => resolve([]);
      } catch (e) {
        console.warn('Error reading from IndexedDB:', e);
        resolve([]);
      }
    });
  }

  /**
   * Delete track from IndexedDB
   */
  async deleteTrackFromDB(id) {
    if (!this.db) await this.initDB();
    if (!this.db) return;
    try {
      const tx = this.db.transaction('tracks', 'readwrite');
      tx.objectStore('tracks').delete(id);
    } catch (e) {
      console.warn('Error deleting track from DB:', e);
    }
  }

  /**
   * Clear all tracks from IndexedDB
   */
  async clearAllTracks() {
    if (!this.db) await this.initDB();
    if (!this.db) return;
    try {
      const tx = this.db.transaction('tracks', 'readwrite');
      tx.objectStore('tracks').clear();
    } catch (e) {
      console.warn('Error clearing DB:', e);
    }
  }

  /**
   * Format seconds into MM:SS or HH:MM:SS
   */
  formatTime(seconds) {
    if (isNaN(seconds) || seconds <= 0) return '0:00';
    const s = Math.floor(seconds);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;

    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * =========================================================================
   * PLAYLIST SYSTEM METHODS
   * =========================================================================
   */

  /**
   * Get all playlists from IndexedDB (with localStorage backup)
   */
  async getPlaylists() {
    if (!this.db) await this.initDB();
    if (!this.db) {
      return this.getPlaylistsFromLocalStorage();
    }

    return new Promise((resolve) => {
      try {
        if (!this.db.objectStoreNames.contains('playlists')) {
          resolve(this.getPlaylistsFromLocalStorage());
          return;
        }
        const tx = this.db.transaction('playlists', 'readonly');
        const store = tx.objectStore('playlists');
        const req = store.getAll();

        req.onsuccess = () => {
          const playlists = req.result || [];
          if (playlists.length === 0) {
            const local = this.getPlaylistsFromLocalStorage();
            if (local.length > 0) {
              local.forEach(p => this.savePlaylist(p));
              resolve(local);
              return;
            }
          }
          resolve(playlists);
        };

        req.onerror = () => resolve(this.getPlaylistsFromLocalStorage());
      } catch (e) {
        console.warn('Error fetching playlists:', e);
        resolve(this.getPlaylistsFromLocalStorage());
      }
    });
  }

  getPlaylistsFromLocalStorage() {
    try {
      const data = localStorage.getItem('musico_playlists');
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  savePlaylistsToLocalStorage(playlists) {
    try {
      localStorage.setItem('musico_playlists', JSON.stringify(playlists));
    } catch (e) {
      console.warn('LocalStorage save error:', e);
    }
  }

  /**
   * Create or update a playlist
   */
  async savePlaylist(playlist) {
    if (!playlist || !playlist.id) return;
    if (!playlist.trackIds) playlist.trackIds = [];
    if (typeof playlist.playCount !== 'number') playlist.playCount = 0;
    if (!playlist.createdAt) playlist.createdAt = Date.now();

    // Synchronize to LocalStorage immediately
    const localPlaylists = this.getPlaylistsFromLocalStorage();
    const idx = localPlaylists.findIndex(p => p.id === playlist.id);
    if (idx !== -1) {
      localPlaylists[idx] = playlist;
    } else {
      localPlaylists.push(playlist);
    }
    this.savePlaylistsToLocalStorage(localPlaylists);

    // Save to IndexedDB
    if (!this.db) await this.initDB();
    if (!this.db || !this.db.objectStoreNames.contains('playlists')) return;

    try {
      const tx = this.db.transaction('playlists', 'readwrite');
      tx.objectStore('playlists').put(playlist);
    } catch (e) {
      console.warn('Error saving playlist to DB:', e);
    }
  }

  /**
   * Delete a playlist from storage (Does NOT delete songs from library)
   */
  async deletePlaylist(playlistId) {
    if (!playlistId) return;

    // Remove from LocalStorage
    const localPlaylists = this.getPlaylistsFromLocalStorage().filter(p => p.id !== playlistId);
    this.savePlaylistsToLocalStorage(localPlaylists);

    // Remove from IndexedDB
    if (!this.db) await this.initDB();
    if (!this.db || !this.db.objectStoreNames.contains('playlists')) return;

    try {
      const tx = this.db.transaction('playlists', 'readwrite');
      tx.objectStore('playlists').delete(playlistId);
    } catch (e) {
      console.warn('Error deleting playlist from DB:', e);
    }
  }

  /**
   * Add track IDs to a playlist
   */
  async addTracksToPlaylist(playlistId, trackIds) {
    if (!playlistId || !trackIds || trackIds.length === 0) return null;
    const playlists = await this.getPlaylists();
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return null;

    const idsToAdd = Array.isArray(trackIds) ? trackIds : [trackIds];
    if (!playlist.trackIds) playlist.trackIds = [];

    // Avoid duplicate IDs in the same playlist or allow appending
    idsToAdd.forEach(id => {
      if (!playlist.trackIds.includes(id)) {
        playlist.trackIds.push(id);
      }
    });

    await this.savePlaylist(playlist);
    return playlist;
  }

  /**
   * Remove a single track from a playlist (Does NOT delete song from library)
   */
  async removeTrackFromPlaylist(playlistId, trackId) {
    if (!playlistId || !trackId) return null;
    const playlists = await this.getPlaylists();
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist || !playlist.trackIds) return null;

    playlist.trackIds = playlist.trackIds.filter(id => id !== trackId);
    await this.savePlaylist(playlist);
    return playlist;
  }

  /**
   * Increment playlist play count for Fav. ranking
   */
  async incrementPlaylistPlayCount(playlistId) {
    if (!playlistId) return;
    const playlists = await this.getPlaylists();
    const playlist = playlists.find(p => p.id === playlistId);
    if (playlist) {
      playlist.playCount = (playlist.playCount || 0) + 1;
      playlist.lastPlayed = Date.now();
      await this.savePlaylist(playlist);
    }
  }
}

window.FileManager = FileManager;
