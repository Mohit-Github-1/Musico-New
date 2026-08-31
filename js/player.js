/**
 * Musico - Audio Player Engine & Web Audio Visualizer
 * Controls audio playback, seek, volume, shuffle, queue, and real-time equalizer bars.
 */

class MusicPlayer {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';

    this.queue = [];
    this.originalQueue = [];
    this.currentIndex = -1;
    this.currentTrack = null;
    this.isPlaying = false;
    this.isShuffle = false;
    this.repeatMode = 'all';
    this.volume = 0.85;

    // Web Audio API setup
    this.audioCtx = null;
    this.analyser = null;
    this.sourceNode = null;
    this.gainNode = null;
    this.isAudioCtxInitialized = false;

    this.setupAudioListeners();
  }

  /**
   * Initialize Web Audio API nodes (on first user interaction)
   */
  initWebAudio() {
    if (this.isAudioCtxInitialized) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContext();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.smoothingTimeConstant = 0.8;

      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.setValueAtTime(this.volume, this.audioCtx.currentTime);

      this.sourceNode = this.audioCtx.createMediaElementSource(this.audio);
      this.sourceNode.connect(this.gainNode);
      this.gainNode.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);

      this.isAudioCtxInitialized = true;
      this.startVisualizerLoop();
    } catch (e) {
      console.warn('Web Audio API could not be initialized:', e);
    }
  }

  /**
   * Setup audio event listeners
   */
  setupAudioListeners() {
    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      this.updatePlayPauseUI();
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      this.updatePlayPauseUI();
    });

    this.audio.addEventListener('timeupdate', () => {
      this.updateProgressUI();
    });

    this.audio.addEventListener('loadedmetadata', () => {
      if (this.currentTrack && (!this.currentTrack.duration || this.currentTrack.isLocal)) {
        this.currentTrack.duration = this.audio.duration;
      }
      this.updateProgressUI();
    });

    this.audio.addEventListener('ended', () => {
      if (this.repeatMode === 'one') {
        this.audio.currentTime = 0;
        this.audio.play();
      } else {
        this.next();
      }
    });

    this.audio.addEventListener('error', (e) => {
      console.warn('Audio playback error:', e);
      this.isPlaying = false;
      this.updatePlayPauseUI();
    });
  }

  /**
   * Set playback queue
   */
  setQueue(tracks, startIndex = 0, startPlay = true) {
    this.originalQueue = [...tracks];
    if (this.originalQueue.length === 0) {
      this.queue = [];
      this.currentIndex = -1;
      this.currentTrack = null;
      this.audio.pause();
      this.audio.src = '';
      this.isPlaying = false;
      this.updateNowPlayingUI();
      this.updatePlayPauseUI();
      this.updateProgressUI();
      return;
    }

    if (this.isShuffle) {
      this.queue = this.shuffleArray([...tracks]);
      const currentInShuffled = this.queue.findIndex(t => t.id === tracks[startIndex].id);
      this.currentIndex = currentInShuffled !== -1 ? currentInShuffled : 0;
    } else {
      this.queue = [...tracks];
      this.currentIndex = startIndex;
    }

    if (startPlay && this.queue.length > 0) {
      this.loadAndPlay(this.currentIndex);
    } else if (this.queue.length > 0) {
      this.loadTrack(this.currentIndex);
    }
  }

  /**
   * Load track at index
   */
  async loadTrack(index) {
    if (index < 0 || index >= this.queue.length) return;
    this.currentIndex = index;
    this.currentTrack = this.queue[index];

    const src = this.currentTrack.audioUrl;
    if (src) {
      this.audio.src = src;
    }
    this.audio.currentTime = 0;

    this.updateNowPlayingUI();
    this.updateProgressUI();
  }

  /**
   * Load and play track at index
   */
  async loadAndPlay(index) {
    this.initWebAudio();
    await this.loadTrack(index);
    try {
      await this.audio.play();
      this.isPlaying = true;
    } catch (err) {
      console.warn('Auto-play error:', err);
    }
    this.updatePlayPauseUI();
    this.updateProgressUI();
  }

  /**
   * Toggle Play / Pause
   */
  async togglePlay() {
    this.initWebAudio();
    if (!this.currentTrack) {
      if (this.queue.length > 0) {
        this.loadAndPlay(0);
      }
      return;
    }

    if (this.audio.paused) {
      try {
        await this.audio.play();
        this.isPlaying = true;
      } catch (e) {
        console.warn('Play error:', e);
      }
    } else {
      this.audio.pause();
      this.isPlaying = false;
    }
    this.updatePlayPauseUI();
  }

  /**
   * Next Track
   */
  next() {
    if (this.queue.length === 0) return;
    let nextIndex = this.currentIndex + 1;
    if (nextIndex >= this.queue.length) {
      if (this.repeatMode === 'all') {
        nextIndex = 0;
      } else {
        return;
      }
    }
    this.loadAndPlay(nextIndex);
  }

  /**
   * Previous Track
   */
  prev() {
    if (this.queue.length === 0) return;
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      this.updateProgressUI();
      return;
    }
    let prevIndex = this.currentIndex - 1;
    if (prevIndex < 0) {
      prevIndex = this.queue.length - 1;
    }
    this.loadAndPlay(prevIndex);
  }

  /**
   * Seek to position in percentage (0-100)
   */
  seek(percent) {
    if (!this.currentTrack) return;
    const dur = this.audio.duration || this.currentTrack.duration || 1;
    const clampedPercent = Math.max(0, Math.min(100, percent));
    this.audio.currentTime = (clampedPercent / 100) * dur;
    this.updateProgressUI();
  }

  /**
   * Set Volume (0 to 1)
   */
  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, val));
    this.audio.volume = this.volume;
    if (this.gainNode && this.audioCtx) {
      this.gainNode.gain.setValueAtTime(this.volume, this.audioCtx.currentTime);
    }
  }

  /**
   * Toggle Shuffle Mode
   */
  toggleShuffle() {
    this.isShuffle = !this.isShuffle;
    if (this.isShuffle) {
      const currentTrackId = this.currentTrack ? this.currentTrack.id : null;
      this.queue = this.shuffleArray([...this.originalQueue]);
      if (currentTrackId) {
        this.currentIndex = this.queue.findIndex(t => t.id === currentTrackId);
      }
    } else {
      const currentTrackId = this.currentTrack ? this.currentTrack.id : null;
      this.queue = [...this.originalQueue];
      if (currentTrackId) {
        this.currentIndex = this.queue.findIndex(t => t.id === currentTrackId);
      }
    }

    const shuffleBtns = [
      document.getElementById('filterShuffleBtn'),
      document.getElementById('mobileFilterShuffleBtn'),
      document.getElementById('mobileFullFilterShuffleBtn')
    ];
    shuffleBtns.forEach(btn => {
      if (btn) btn.classList.toggle('active', this.isShuffle);
    });

    if (window.updateMobileUpNextUI) {
      window.updateMobileUpNextUI();
    }

    return this.isShuffle;
  }

  /**
   * Set Repeat Mode ('off', 'all', 'one')
   */
  setRepeatMode(mode) {
    this.repeatMode = mode;
    if (window.updateMobileUpNextUI) {
      window.updateMobileUpNextUI();
    }
  }

  /**
   * Toggle Repeat Mode
   */
  toggleRepeat() {
    if (this.repeatMode === 'off') {
      this.repeatMode = 'all';
    } else if (this.repeatMode === 'all') {
      this.repeatMode = 'one';
    } else {
      this.repeatMode = 'off';
    }
    if (window.updateMobileUpNextUI) {
      window.updateMobileUpNextUI();
    }
    return this.repeatMode;
  }

  /**
   * Fisher-Yates shuffle
   */
  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * Format seconds to string MM:SS or HH:MM:SS
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
   * Update Play / Pause UI elements across Desktop & Mobile players
   */
  updatePlayPauseUI() {
    const playBtns = [
      document.getElementById('playPauseBtn'),
      document.getElementById('mobilePopupPlayPauseBtn'),
      document.getElementById('mobileFullPlayPauseBtn')
    ];

    const pauseSvg = `
      <svg width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="7" y="5" width="6" height="24" rx="3" fill="currentColor"/>
        <rect x="21" y="5" width="6" height="24" rx="3" fill="currentColor"/>
      </svg>
    `;

    const playSvg = `
      <svg width="35" height="37" viewBox="0 0 35 37" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M28.1899 11.144C33.5891 14.2102 33.589 21.9908 28.1899 25.0571L13.9507 33.144C8.61755 36.1726 1.99951 32.3201 1.99951 26.187L1.99951 10.0142C1.99984 3.88133 8.61769 0.0295751 13.9507 3.05811L28.1899 11.144Z" stroke="currentColor" stroke-width="3.5" fill="none"/>
      </svg>
    `;

    playBtns.forEach(btn => {
      if (!btn) return;
      if (this.isPlaying) {
        btn.innerHTML = pauseSvg;
        btn.setAttribute('title', 'Pause');
        btn.setAttribute('aria-label', 'Pause');
      } else {
        btn.innerHTML = playSvg;
        btn.setAttribute('title', 'Play');
        btn.setAttribute('aria-label', 'Play');
      }
    });

    document.querySelectorAll('.song-card').forEach(card => {
      const isCurrent = this.currentTrack && card.dataset.id === this.currentTrack.id;
      card.classList.toggle('active', isCurrent);
      card.classList.toggle('playing', isCurrent && this.isPlaying);
    });

    // Toggle compact popup visibility on mobile
    const mobilePopup = document.getElementById('mobileCompactPopup');
    if (mobilePopup) {
      mobilePopup.classList.toggle('visible', Boolean(this.currentTrack));
    }
  }

  /**
   * Update Progress bar & Time display (Audio Timeline) with EXACT synchronization
   */
  updateProgressUI() {
    const timeDisplay = document.getElementById('playerTimeDisplay');
    const progressPill = document.getElementById('progressPill');
    const mobilePopupTimeDisplay = document.getElementById('mobilePopupTimeDisplay');
    const mobilePopupProgressBar = document.getElementById('mobilePopupProgressBar');
    const mobileFullTimeDisplay = document.getElementById('mobileFullTimeDisplay');
    const mobileFullProgressPill = document.getElementById('mobileFullProgressPill');

    if (!this.currentTrack) {
      if (timeDisplay) timeDisplay.textContent = '0:00/0:00';
      if (progressPill) progressPill.style.width = '0%';
      if (mobilePopupTimeDisplay) mobilePopupTimeDisplay.textContent = '0:00/0:00';
      if (mobilePopupProgressBar) mobilePopupProgressBar.style.width = '0%';
      if (mobileFullTimeDisplay) mobileFullTimeDisplay.textContent = '0:00/0:00';
      if (mobileFullProgressPill) mobileFullProgressPill.style.width = '0%';
      return;
    }

    const curTime = this.audio.currentTime || 0;
    const dur = this.audio.duration || this.currentTrack.duration || 0;
    const progressPercent = dur > 0 ? Math.min(100, Math.max(0, (curTime / dur) * 100)) : 0;
    const formattedTime = `${this.formatTime(curTime)}/${this.formatTime(dur)}`;

    // Desktop
    if (timeDisplay) {
      timeDisplay.textContent = formattedTime;
    }
    if (progressPill) {
      progressPill.style.width = `${progressPercent}%`;
    }

    // Mobile Compact Popup
    if (mobilePopupTimeDisplay) {
      mobilePopupTimeDisplay.textContent = formattedTime;
    }
    if (mobilePopupProgressBar) {
      mobilePopupProgressBar.style.width = `${progressPercent}%`;
    }

    // Mobile Full Now Playing
    if (mobileFullTimeDisplay) {
      mobileFullTimeDisplay.textContent = formattedTime;
    }
    if (mobileFullProgressPill) {
      mobileFullProgressPill.style.width = `${progressPercent}%`;
    }
  }

  /**
   * Update Now Playing Section UI (Art, Title, Artist) across Desktop & Mobile players
   */
  updateNowPlayingUI() {
    const artistNameElem = document.getElementById('nowPlayingArtist');
    const titleElem = document.getElementById('nowPlayingTitle');
    const albumArtElem = document.getElementById('nowPlayingAlbumArt');

    const mobilePopupCover = document.getElementById('mobilePopupCoverArt');
    const mobileFullArtist = document.getElementById('mobileFullArtist');
    const mobileFullTitle = document.getElementById('mobileFullTitle');
    const mobileFullAlbumArt = document.getElementById('mobileFullAlbumArt');

    if (!this.currentTrack) {
      if (artistNameElem) artistNameElem.textContent = 'Unknown';
      if (titleElem) titleElem.textContent = 'No Songs';
      if (albumArtElem) {
        albumArtElem.src = 'assets/Mlogowithbg.png';
        albumArtElem.alt = 'Musico - No Song Playing';
        albumArtElem.className = 'album-art-img fallback-art';
      }

      if (mobilePopupCover) {
        mobilePopupCover.src = 'assets/M logo for music items.png';
        mobilePopupCover.className = 'mobile-popup-cover fallback-art';
      }
      if (mobileFullArtist) mobileFullArtist.textContent = 'Unknown';
      if (mobileFullTitle) mobileFullTitle.textContent = 'No Songs';
      if (mobileFullAlbumArt) {
        mobileFullAlbumArt.src = 'assets/Mlogowithbg.png';
        mobileFullAlbumArt.className = 'mobile-full-art fallback-art';
      }
      return;
    }

    const artistText = this.currentTrack.artist || 'Unknown';
    const titleText = this.currentTrack.title || 'Unknown Track';

    // Desktop
    if (artistNameElem) artistNameElem.textContent = artistText;
    if (titleElem) titleElem.textContent = titleText;

    // Mobile Full
    if (mobileFullArtist) mobileFullArtist.textContent = artistText;
    if (mobileFullTitle) mobileFullTitle.textContent = titleText;

    const isFallback = !this.currentTrack.coverUrl || 
                       this.currentTrack.coverUrl.includes('M logo for music items') ||
                       this.currentTrack.coverUrl.includes('MlogoforMusicItems') ||
                       this.currentTrack.coverUrl.includes('Mlogo') || 
                       this.currentTrack.coverUrl.includes('Group 4') || 
                       this.currentTrack.coverUrl.trim() === '';

    // Album Arts
    if (albumArtElem) {
      if (isFallback) {
        albumArtElem.src = 'assets/Mlogowithbg.png';
        albumArtElem.alt = titleText;
        albumArtElem.className = 'album-art-img fallback-art';
      } else {
        albumArtElem.src = this.currentTrack.coverUrl;
        albumArtElem.alt = titleText;
        albumArtElem.className = 'album-art-img';
      }
    }

    if (mobilePopupCover) {
      if (isFallback) {
        mobilePopupCover.src = 'assets/M logo for music items.png';
        mobilePopupCover.className = 'mobile-popup-cover fallback-art';
      } else {
        mobilePopupCover.src = this.currentTrack.coverUrl;
        mobilePopupCover.className = 'mobile-popup-cover';
      }
    }

    if (mobileFullAlbumArt) {
      if (isFallback) {
        mobileFullAlbumArt.src = 'assets/Mlogowithbg.png';
        mobileFullAlbumArt.className = 'mobile-full-art fallback-art';
      } else {
        mobileFullAlbumArt.src = this.currentTrack.coverUrl;
        mobileFullAlbumArt.className = 'mobile-full-art';
      }
    }

    if (window.updateMobileUpNextUI) {
      window.updateMobileUpNextUI();
    }
  }

  /**
   * Real-time equalizer visualizer animation loop
   */
  startVisualizerLoop() {
    const bars = [
      document.getElementById('eqBar1'),
      document.getElementById('eqBar2'),
      document.getElementById('eqBar3'),
      document.getElementById('eqBar4')
    ];

    const dataArray = new Uint8Array(32);

    const renderVisualizer = () => {
      requestAnimationFrame(renderVisualizer);

      if (this.analyser && this.isPlaying) {
        this.analyser.getByteFrequencyData(dataArray);

        const v1 = (dataArray[2] / 255);
        const v2 = (dataArray[6] / 255);
        const v3 = (dataArray[12] / 255);
        const v4 = (dataArray[20] / 255);

        const heights = [
          Math.max(6, v1 * 26),
          Math.max(6, v2 * 26),
          Math.max(6, v3 * 26),
          Math.max(6, v4 * 26)
        ];

        bars.forEach((bar, idx) => {
          if (bar) bar.style.height = `${heights[idx]}px`;
        });
      } else {
        bars.forEach((bar) => {
          if (bar) bar.style.height = '14px';
        });
      }
    };

    renderVisualizer();
  }
}

window.MusicPlayer = MusicPlayer;
