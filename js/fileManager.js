/**
 * Musico - File Manager & Local Storage (IndexedDB)
 * Handles local folder scanning, file reading, and offline storage.
 */

class FileManager {
  constructor() {
    this.db = null;
    this.dbName = 'MusicoDB';
    this.dbVersion = 1;
    this.initDB();
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
   * Select a folder using Modern File System Access API
   */
  async selectDirectory() {
    if ('showDirectoryPicker' in window) {
      try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
        const audioFiles = [];
        await this.scanDirectoryHandle(dirHandle, audioFiles);
        return await this.processAudioFiles(audioFiles);
      } catch (err) {
        if (err.name === 'AbortError') return [];
        console.warn('Directory Picker fallback:', err);
        return this.triggerDirectoryInput();
      }
    } else {
      return this.triggerDirectoryInput();
    }
  }

  /**
   * Recursively scan FileSystemDirectoryHandle
   */
  async scanDirectoryHandle(dirHandle, fileList) {
    const audioExtensions = /\.(mp3|wav|ogg|flac|m4a|aac|opus|weba|webm)$/i;
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file' && audioExtensions.test(entry.name)) {
        try {
          const file = await entry.getFile();
          fileList.push(file);
        } catch (e) {
          console.warn('Could not read file:', entry.name, e);
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
   * Fallback: Trigger input file with webkitdirectory
   */
  triggerDirectoryInput() {
    return new Promise((resolve) => {
      const input = document.getElementById('folderPickerInput') || document.createElement('input');
      input.type = 'file';
      input.webkitdirectory = true;
      input.directory = true;
      input.multiple = true;
      input.accept = 'audio/*';

      input.onchange = async (e) => {
        const files = Array.from(e.target.files).filter(f => 
          /\.(mp3|wav|ogg|flac|m4a|aac|opus|weba|webm)$/i.test(f.name) || f.type.startsWith('audio/')
        );
        const tracks = await this.processAudioFiles(files);
        resolve(tracks);
      };

      input.click();
    });
  }

  /**
   * Process and parse raw audio File objects from local disk
   */
  async processAudioFiles(files) {
    const tracks = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const meta = await ID3Parser.parse(file);
        const id = 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const objectUrl = URL.createObjectURL(file);

        const duration = await this.getAudioDuration(objectUrl);

        const track = {
          id: id,
          title: meta.title || file.name.replace(/\.[^/.]+$/, ''),
          artist: meta.artist || 'Unknown',
          album: meta.album || 'Unknown Album',
          year: meta.year || '',
          duration: duration || 0,
          formattedDuration: this.formatTime(duration || 0),
          coverUrl: meta.coverUrl || 'assets/M logo for music items.png',
          coverBlob: meta.coverBlob || null,
          hasEmbeddedCover: Boolean(meta.coverBlob || (meta.coverUrl && !meta.coverUrl.includes('M logo'))),
          fileBlob: file,
          audioUrl: objectUrl,
          isLocal: true,
          addedAt: Date.now()
        };

        tracks.push(track);
        this.saveTrackToDB(track);
      } catch (err) {
        console.warn('Error processing audio file:', file.name, err);
      }
    }
    return tracks;
  }

  /**
   * Clean default placeholder cover for songs without embedded cover art
   */
  getDefaultCoverSvg() {
    return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="300" height="300" fill="%23111111"/><circle cx="150" cy="150" r="100" fill="%231a1a1a" stroke="%23333333" stroke-width="3"/><circle cx="150" cy="150" r="40" fill="%23111111" stroke="%23444444" stroke-width="2"/><circle cx="150" cy="150" r="12" fill="%23ffffff"/><path d="M140 100 L140 160 A20 20 0 1 0 155 178 L155 120 L180 120 L180 100 Z" fill="%23ffffff"/></svg>';
  }

  /**
   * Get duration of audio URL
   */
  getAudioDuration(url) {
    return new Promise((resolve) => {
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.src = url;
      audio.onloadedmetadata = () => resolve(audio.duration);
      audio.onerror = () => resolve(0);
      setTimeout(() => resolve(0), 2000);
    });
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
   * Save track to IndexedDB
   */
  async saveTrackToDB(track) {
    if (!this.db) await this.initDB();
    if (!this.db) return;

    try {
      const tx = this.db.transaction('tracks', 'readwrite');
      const store = tx.objectStore('tracks');
      store.put(track);
    } catch (e) {
      console.warn('Could not save track to IndexedDB:', e);
    }
  }

  /**
   * Load stored tracks from IndexedDB with persistent cover artwork restoration
   */
  async loadStoredTracks() {
    if (!this.db) await this.initDB();
    if (!this.db) return [];

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('tracks', 'readonly');
        const store = tx.objectStore('tracks');
        const req = store.getAll();

        req.onsuccess = async () => {
          const tracks = req.result || [];
          for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            // Recreate audio object URL
            if (track.fileBlob) {
              track.audioUrl = URL.createObjectURL(track.fileBlob);
            }
            // Recreate cover art object URL from stored coverBlob
            if (track.coverBlob) {
              track.coverUrl = URL.createObjectURL(track.coverBlob);
              track.hasEmbeddedCover = true;
            } else if (track.hasEmbeddedCover && track.fileBlob) {
              // Backward compatibility: re-extract coverBlob if not saved previously
              try {
                const reParsed = await ID3Parser.parse(track.fileBlob);
                if (reParsed && reParsed.coverBlob) {
                  track.coverBlob = reParsed.coverBlob;
                  track.coverUrl = URL.createObjectURL(reParsed.coverBlob);
                  track.hasEmbeddedCover = true;
                  this.saveTrackToDB(track);
                } else {
                  track.coverUrl = 'assets/M logo for music items.png';
                  track.hasEmbeddedCover = false;
                }
              } catch (e) {
                track.coverUrl = 'assets/M logo for music items.png';
                track.hasEmbeddedCover = false;
              }
            } else {
              track.coverUrl = 'assets/M logo for music items.png';
              track.hasEmbeddedCover = false;
            }
          }
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
}

window.FileManager = FileManager;
