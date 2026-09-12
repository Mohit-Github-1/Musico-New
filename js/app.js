/**
 * Musico - Main Application Controller
 * Handles local folder loading, UI rendering, search, modals, and events.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const fileManager = new FileManager();
  const player = new MusicPlayer();
  window.appPlayer = player;
  window.appFileManager = fileManager;

  // App State
  let allTracks = [];
  let currentFilter = 'all';
  let isGridView = false;
  let currentView = 'all_songs'; // 'all_songs', 'playlists', 'playlist_songs'
  let activePlaylistId = null;
  let playlists = [];
  let isSelectMode = false;
  let selectedTrackIds = new Set();
  let modalPendingTrackIds = [];
  let playlistContextMenuTargetId = null;
  let searchQuery = '';
  let isSearchHistoryActive = false;
  let currentTheme = localStorage.getItem('musico-theme') || 'dark';

  // Clear any residual search history state from previous reloads
  if (window.history && window.history.state && window.history.state.isSearch) {
    try {
      window.history.replaceState(null, '');
    } catch (e) {}
  }

  function enterSearchHistory() {
    if (!isSearchHistoryActive) {
      try {
        window.history.pushState({ isSearch: true }, '');
        isSearchHistoryActive = true;
      } catch (e) {}
    }
  }

  function exitSearchToAllSongs() {
    searchQuery = '';
    if (searchInput) searchInput.value = '';
    if (searchOverlay) searchOverlay.classList.remove('open');
    isSearchHistoryActive = false;
    if (window.history && window.history.state && window.history.state.isSearch) {
      try {
        window.history.replaceState(null, '');
      } catch (e) {}
    }
    setAllFilter();
  }

  // DOM Elements
  const songsListContainer = document.getElementById('songsListContainer');
  const addFolderBtn = document.getElementById('addFolderBtn');
  const searchBtn = document.getElementById('searchBtn');
  const searchOverlay = document.getElementById('searchOverlay');
  const searchInput = document.getElementById('searchInput');
  const closeSearchBtn = document.getElementById('closeSearchBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const playPauseBtn = document.getElementById('playPauseBtn');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const filterAllBtn = document.getElementById('filterAllBtn');
  const filterColumnBtn = document.getElementById('filterColumnBtn');
  const filterShuffleBtn = document.getElementById('filterShuffleBtn');
  const topSliderTrack = document.getElementById('topSliderTrack');
  const topSliderThumb = document.getElementById('topSliderThumb');
  const progressPill = document.getElementById('progressPill');
  const progressBarContainer = document.getElementById('progressBarContainer');
  const viewSelectorPill = document.getElementById('viewSelectorPill');
  const viewDropdownMenu = document.getElementById('viewDropdownMenu');
  const contextMenu = document.getElementById('songContextMenu');
  const toastMessage = document.getElementById('toastMessage');

  // Loading Progress Popup Elements
  const loadingProgressPopup = document.getElementById('loadingProgressPopup');
  const loadingProgressCount = document.getElementById('loadingProgressCount');
  const loadingProgressBarFill = document.getElementById('loadingProgressBarFill');

  /**
   * Display and update the Loading Progress Popup
   * Communicates actual progress with remaining count and percentage fill
   */
  function showLoadingProgress(remaining, percent) {
    if (!loadingProgressPopup) return;
    loadingProgressPopup.classList.add('visible');
    if (loadingProgressCount) {
      loadingProgressCount.textContent = `${remaining} song${remaining === 1 ? '' : 's'} remaining`;
    }
    if (loadingProgressBarFill) {
      loadingProgressBarFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    }
  }

  /**
   * Automatically hide Loading Progress Popup after completion
   */
  function hideLoadingProgress() {
    if (!loadingProgressPopup) return;
    if (loadingProgressBarFill) {
      loadingProgressBarFill.style.width = '100%';
    }
    if (loadingProgressCount) {
      loadingProgressCount.textContent = '0 songs remaining';
    }
    setTimeout(() => {
      loadingProgressPopup.classList.remove('visible');
      setTimeout(() => {
        if (loadingProgressBarFill) loadingProgressBarFill.style.width = '0%';
      }, 300);
    }, 450);
  }

  /**
   * High-speed in-place DOM metadata updater for large libraries
   * Updates song cards directly without re-rendering or resetting scroll position
   */
  function updateVisibleSongCardMetadata(updatedTracks) {
    if (!songsListContainer || !updatedTracks || updatedTracks.length === 0) return;
    for (let i = 0; i < updatedTracks.length; i++) {
      const track = updatedTracks[i];
      const card = songsListContainer.querySelector(`.song-card[data-id="${track.id}"]`);
      if (card) {
        const titleElem = card.querySelector('.song-title');
        const artistElem = card.querySelector('.song-artist');
        const thumbElem = card.querySelector('.song-thumb');

        if (titleElem && track.title) titleElem.textContent = track.title;
        if (artistElem && track.artist) artistElem.textContent = `//${track.artist}`;
        if (thumbElem && track.hasEmbeddedCover && track.coverUrl) {
          thumbElem.src = track.coverUrl;
          thumbElem.classList.remove('fallback-logo');
        }
      }
    }
  }

  // Initialize Library from IndexedDB
  async function initLibrary() {
    playlists = await fileManager.getPlaylists();
    const savedTracks = await fileManager.loadStoredTracks();
    if (savedTracks && savedTracks.length > 0) {
      allTracks = [...savedTracks];
      FileManager.sortTracks(allTracks);
      renderSongList();

      // Restore last played song if it exists in the library, otherwise default to first song
      const lastPlayedId = localStorage.getItem('musico-last-played-id');
      let targetIndex = 0;
      if (lastPlayedId) {
        const foundIdx = allTracks.findIndex(t => t.id === lastPlayedId);
        if (foundIdx !== -1) {
          targetIndex = foundIdx;
        }
      }
      player.setQueue(allTracks, targetIndex, false);
    } else {
      allTracks = [];
      renderSongList();
      player.setQueue([], 0, false);
    }
  }

  // Generate Song Card HTML
  function generateSongCardHTML(track, idx, isInsidePlaylist = false) {
    const isCurrent = player.currentTrack && player.currentTrack.id === track.id;
    const isPlaying = isCurrent && player.isPlaying;
    const isSelected = selectedTrackIds.has(track.id);
    const isFallback = !track.coverUrl || 
                       track.coverUrl.includes('M logo for music items') ||
                       track.coverUrl.includes('MlogoforMusicItems') ||
                       track.coverUrl.includes('Mlogo.png') || 
                       track.coverUrl.includes('Group 4') || 
                       track.coverUrl.trim() === '';
    const coverSrc = isFallback ? 'assets/M logo for music items.png' : track.coverUrl;

    return `
      <div class="song-card ${isCurrent ? 'active' : ''} ${isPlaying ? 'playing' : ''} ${isSelected ? 'selected' : ''}" data-id="${track.id}" data-index="${idx}" ${isInsidePlaylist ? 'data-playlist-song="true"' : ''}>
        <div class="song-checkbox-wrapper">
          <div class="song-checkbox"></div>
        </div>
        <div class="song-card-left">
          <div class="song-thumb-wrapper">
            <img src="${coverSrc}" alt="${escapeHtml(track.title)}" class="song-thumb ${isFallback ? 'fallback-logo' : ''}" loading="lazy" onerror="this.onerror=null;this.src='assets/M logo for music items.png';this.className='song-thumb fallback-logo';" />
          </div>
          <div class="song-info">
            <span class="song-title">${escapeHtml(track.title)}</span>
            <span class="song-artist">//${escapeHtml(track.artist || 'Unknown')}</span>
          </div>
        </div>
        <button class="song-options-btn" data-id="${track.id}" ${isInsidePlaylist ? 'data-in-playlist="true"' : ''} aria-label="Song options" title="Options">
          <img src="${currentTheme === 'dark' ? 'assets/Dark Mode/DarkModeOptionsbtn.svg' : 'assets/OptionsThreeDots.svg'}" alt="Options" class="options-icon" />
        </button>
      </div>
    `;
  }

  // Generate Playlist Card HTML (No cover images in list, matching reference design)
  function generatePlaylistCardHTML(playlist) {
    const trackCount = playlist.trackIds ? playlist.trackIds.length : 0;
    const countText = trackCount === 1 ? '1 Song' : `${trackCount} Songs`;
    return `
      <div class="playlist-card" data-playlist-id="${playlist.id}">
        <div class="playlist-card-left">
          <span class="playlist-card-title">${escapeHtml(playlist.name)}</span>
          <span class="playlist-card-count">//${countText}</span>
        </div>
        <button class="playlist-options-btn" data-playlist-id="${playlist.id}" aria-label="Playlist options" title="Options">
          <img src="${currentTheme === 'dark' ? 'assets/Dark Mode/DarkModeOptionsbtn.svg' : 'assets/OptionsThreeDots.svg'}" alt="Options" class="options-icon" />
        </button>
      </div>
    `;
  }

  // Render song cards in right panel (High-Performance Windowed Virtualization for 1,000–5,000+ songs)
  function renderSongList() {
    if (!songsListContainer) return;

    let filtered = allTracks;

    // Apply search filter if query is present
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(t => 
        t.title.toLowerCase().includes(q) || 
        (t.artist && t.artist.toLowerCase().includes(q)) ||
        (t.album && t.album.toLowerCase().includes(q))
      );
    }

    // When there are no songs or no folder selected -> Show 'No Songs' empty state
    if (filtered.length === 0) {
      songsListContainer.className = 'songs-list empty-container';
      songsListContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">
            <img src="assets/ADD button with no BG.png" alt="Add Music" class="empty-state-img" />
          </div>
          <h3 class="empty-title">No Songs</h3>
          <p class="empty-subtitle">Click <strong>+</strong> or the button below to select a music folder from your computer.</p>
          <button class="empty-add-btn" id="emptyAddBtn">+ Select Music Folder</button>
        </div>
      `;
      const emptyAdd = document.getElementById('emptyAddBtn');
      if (emptyAdd) emptyAdd.onclick = handleAddMusic;
      return;
    }

    songsListContainer.className = isGridView ? 'songs-list grid-view' : 'songs-list';
    if (isSelectMode) songsListContainer.classList.add('select-mode');

    const isMobile = window.innerWidth <= 900;
    const rowHeight = isMobile ? 60 : 64;
    const VIRTUAL_THRESHOLD = 50;

    if (isGridView || filtered.length <= VIRTUAL_THRESHOLD) {
      songsListContainer.innerHTML = filtered.map((track, idx) => generateSongCardHTML(track, idx)).join('');
    } else {
      // List Virtualization: only renders cards in viewport + buffer
      const scrollTop = songsListContainer.scrollTop || 0;
      const viewportHeight = songsListContainer.clientHeight || 600;
      const visibleCount = Math.ceil(viewportHeight / rowHeight);
      const buffer = 15;

      const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - buffer);
      const endIndex = Math.min(filtered.length, startIndex + visibleCount + buffer * 2);

      const topHeight = startIndex * rowHeight;
      const bottomHeight = Math.max(0, (filtered.length - endIndex) * rowHeight);

      const visibleCards = [];
      for (let i = startIndex; i < endIndex; i++) {
        visibleCards.push(generateSongCardHTML(filtered[i], i));
      }

      songsListContainer.innerHTML = `
        <div style="height:${topHeight}px; width:100%; flex-shrink:0; pointer-events:none;"></div>
        ${visibleCards.join('')}
        <div style="height:${bottomHeight}px; width:100%; flex-shrink:0; pointer-events:none;"></div>
      `;
    }

    // Update custom mobile scrollbar position
    requestAnimationFrame(() => {
      updateMobileScrollbarThumb();
      if (typeof updateAlphabetScrollIndicator === 'function') {
        updateAlphabetScrollIndicator(false);
      }
    });
  }

  // =========================================================================
  // PLAYLIST SYSTEM VIEW CONTROLLER (PC & MOBILE)
  // =========================================================================

  function getRandomCoverFromPlaylist(playlist) {
    if (!playlist || !playlist.trackIds || playlist.trackIds.length === 0) return 'assets/M logo.png';
    const randomTrackId = playlist.trackIds[Math.floor(Math.random() * playlist.trackIds.length)];
    const track = allTracks.find(t => t.id === randomTrackId);
    if (track && track.coverUrl && !track.coverUrl.includes('M logo for music items') && !track.coverUrl.includes('Group 4')) {
      return track.coverUrl;
    }
    return 'assets/M logo.png';
  }

  function renderPlaylistFeaturedCards() {
    const featuredCard1 = document.getElementById('featuredCard1');
    const featuredCard2 = document.getElementById('featuredCard2');
    const featuredImg1 = document.getElementById('featuredImg1');
    const featuredImg2 = document.getElementById('featuredImg2');
    const featuredTitle1 = document.getElementById('featuredTitle1');
    const featuredTitle2 = document.getElementById('featuredTitle2');
    const playlistCurrentTitle = document.getElementById('playlistCurrentTitle');

    // Update status title
    if (playlistCurrentTitle) {
      if (player.activePlaylistName) {
        playlistCurrentTitle.textContent = player.activePlaylistName;
      } else {
        playlistCurrentTitle.textContent = 'No playlist playing right now';
      }
    }

    if (!playlists || playlists.length === 0) {
      if (featuredTitle1) featuredTitle1.textContent = 'No Playlist';
      if (featuredTitle2) featuredTitle2.textContent = 'No Playlist';
      if (featuredImg1) featuredImg1.src = 'assets/M logo.png';
      if (featuredImg2) featuredImg2.src = 'assets/M logo.png';
      return;
    }

    // Pick 2 distinct random playlists (or repeat if only 1)
    const p1 = playlists[Math.floor(Math.random() * playlists.length)];
    const remaining = playlists.filter(p => p.id !== p1.id);
    const p2 = remaining.length > 0 ? remaining[Math.floor(Math.random() * remaining.length)] : p1;

    if (featuredTitle1) featuredTitle1.textContent = p1.name;
    if (featuredImg1) featuredImg1.src = getRandomCoverFromPlaylist(p1);
    if (featuredCard1) {
      featuredCard1.onclick = () => renderPlaylistSongsView(p1.id);
    }
    if (featuredTitle1) {
      featuredTitle1.onclick = () => renderPlaylistSongsView(p1.id);
    }

    if (featuredTitle2) featuredTitle2.textContent = p2.name;
    if (featuredImg2) featuredImg2.src = getRandomCoverFromPlaylist(p2);
    if (featuredCard2) {
      featuredCard2.onclick = () => renderPlaylistSongsView(p2.id);
    }
    if (featuredTitle2) {
      featuredTitle2.onclick = () => renderPlaylistSongsView(p2.id);
    }
  }

  function renderPlaylistFavSection() {
    const favList = document.getElementById('playlistFavList');
    if (!favList) return;

    const playedPlaylists = playlists.filter(p => (p.playCount || 0) > 0)
      .sort((a, b) => (b.playCount || 0) - (a.playCount || 0));

    if (playedPlaylists.length === 0) {
      favList.innerHTML = `<span class="playlist-fav-empty">No favorite playlist till now</span>`;
      return;
    }

    const top2 = playedPlaylists.slice(0, 2);
    favList.innerHTML = top2.map(p => `
      <span class="playlist-fav-item" data-fav-id="${p.id}" title="Open ${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
    `).join('');

    favList.querySelectorAll('.playlist-fav-item').forEach(item => {
      item.onclick = () => {
        const id = item.dataset.favId;
        renderPlaylistSongsView(id);
      };
    });
  }

  async function renderPlaylistsView() {
    currentView = 'playlists';
    activePlaylistId = null;

    // Reset search state if active
    searchQuery = '';
    if (searchInput) searchInput.value = '';
    if (searchOverlay) searchOverlay.classList.remove('open');
    if (isSearchHistoryActive) {
      isSearchHistoryActive = false;
      try {
        window.history.back();
      } catch (e) {}
    }

    playlists = await fileManager.getPlaylists();

    // Synchronize navbar active states
    document.querySelectorAll('.menu-item-btn').forEach(b => b.classList.toggle('active', b.dataset.action === 'playlists'));
    document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.action === 'playlists'));

    // Update Header
    const libraryHeading = document.querySelector('.library-heading');
    if (libraryHeading) libraryHeading.textContent = 'Playlist';

    // PC Left side: Toggle playlist view active on player body
    const playerBody = document.querySelector('.player-body');
    if (playerBody) playerBody.classList.add('playlist-view-active');

    // Render PC Featured Cards & Fav Section
    renderPlaylistFeaturedCards();
    renderPlaylistFavSection();

    // Render Right side playlist list
    if (!songsListContainer) return;
    songsListContainer.className = 'songs-list playlist-mode';

    if (playlists.length === 0) {
      songsListContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">
            <img src="assets/ADD button with no BG.png" alt="Create Playlist" class="empty-state-img" />
          </div>
          <h3 class="empty-title">No Playlists</h3>
          <p class="empty-subtitle">Create your first playlist to organize your favorite songs.</p>
          <button class="empty-add-btn" id="emptyCreatePlaylistBtn">+ Create New Playlist</button>
        </div>
      `;
      const btn = document.getElementById('emptyCreatePlaylistBtn');
      if (btn) btn.onclick = () => openCreatePlaylistModal();
      return;
    }

    const cardsHTML = playlists.map(p => generatePlaylistCardHTML(p)).join('');
    songsListContainer.innerHTML = `
      <div style="width:100%; margin-bottom: 8px;">
        <button class="playlist-new-btn" id="playlistNewBtn">+ New Playlist</button>
      </div>
      ${cardsHTML}
    `;

    const newBtn = document.getElementById('playlistNewBtn');
    if (newBtn) newBtn.onclick = () => openCreatePlaylistModal();
  }

  async function renderPlaylistSongsView(playlistId) {
    currentView = 'playlist_songs';
    activePlaylistId = playlistId;
    playlists = await fileManager.getPlaylists();
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) {
      renderPlaylistsView();
      return;
    }

    // Update Library Header with Playlist Name & Back Button
    const libraryHeading = document.querySelector('.library-heading');
    if (libraryHeading) {
      libraryHeading.innerHTML = `
        <button class="playlist-back-btn" id="playlistBackBtn" title="Back to Playlists">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          ${escapeHtml(playlist.name)}
        </button>
      `;
      const backBtn = document.getElementById('playlistBackBtn');
      if (backBtn) {
        backBtn.onclick = (e) => {
          e.stopPropagation();
          renderPlaylistsView();
        };
      }
    }

    // Switch Left side back to normal Now Playing view
    const playerBody = document.querySelector('.player-body');
    if (playerBody) playerBody.classList.remove('playlist-view-active');

    // Filter songs belonging to this playlist
    const playlistTracks = (playlist.trackIds || []).map(id => allTracks.find(t => t.id === id)).filter(Boolean);

    if (!songsListContainer) return;
    songsListContainer.className = isGridView ? 'songs-list grid-view' : 'songs-list';
    if (isSelectMode) songsListContainer.classList.add('select-mode');

    if (playlistTracks.length === 0) {
      songsListContainer.className = 'songs-list empty-container';
      songsListContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">
            <img src="assets/ADD button with no BG.png" alt="Add Songs" class="empty-state-img" />
          </div>
          <h3 class="empty-title">Empty Playlist</h3>
          <p class="empty-subtitle">Use <strong>Three-Dots → Add to Playlist</strong> or <strong>Select</strong> from All Songs to add music here.</p>
        </div>
      `;
      return;
    }

    songsListContainer.innerHTML = playlistTracks.map((track, idx) => generateSongCardHTML(track, idx, true)).join('');
    requestAnimationFrame(updateMobileScrollbarThumb);
  }

  // Smooth scroll listener for Virtual List updates
  if (songsListContainer) {
    let isVirtualScrollPending = false;
    songsListContainer.addEventListener('scroll', () => {
      if (!isVirtualScrollPending) {
        isVirtualScrollPending = true;
        requestAnimationFrame(() => {
          isVirtualScrollPending = false;
          if (currentView === 'all_songs' && !isGridView && allTracks.length > 50) {
            renderSongList();
          }
        });
      }
    }, { passive: true });
  }

  // Delegated Event Listener for song cards, playlist cards, and options
  if (songsListContainer) {
    songsListContainer.addEventListener('click', async (e) => {
      // 1. In Multi-Selection Mode
      if (isSelectMode) {
        const card = e.target.closest('.song-card');
        if (card) {
          e.stopPropagation();
          const trackId = card.dataset.id;
          if (selectedTrackIds.has(trackId)) {
            selectedTrackIds.delete(trackId);
          } else {
            selectedTrackIds.add(trackId);
          }
          updateMultiSelectUI();
        }
        return;
      }

      // 2. Playlist 3-dot options
      const playlistOptionsBtn = e.target.closest('.playlist-options-btn');
      if (playlistOptionsBtn) {
        e.stopPropagation();
        const playlistId = playlistOptionsBtn.dataset.playlistId;
        showPlaylistContextMenu(e, playlistId);
        return;
      }

      // 3. Playlist Card Click (opens playlist songs view)
      const playlistCard = e.target.closest('.playlist-card');
      if (playlistCard) {
        const playlistId = playlistCard.dataset.playlistId;
        renderPlaylistSongsView(playlistId);
        return;
      }

      // 4. Song 3-dot options
      const optionsBtn = e.target.closest('.song-options-btn');
      if (optionsBtn) {
        e.stopPropagation();
        const trackId = optionsBtn.dataset.id;
        const isInPlaylist = optionsBtn.dataset.inPlaylist === 'true';
        showContextMenu(e, trackId, isInPlaylist);
        return;
      }

      // 5. Song Card Click (Playback)
      const card = e.target.closest('.song-card');
      if (card) {
        const trackId = card.dataset.id;
        const isInsidePlaylist = card.dataset.playlistSong === 'true';

        if (isInsidePlaylist && activePlaylistId) {
          const playlist = playlists.find(p => p.id === activePlaylistId);
          if (playlist) {
            const playlistTracks = (playlist.trackIds || []).map(id => allTracks.find(t => t.id === id)).filter(Boolean);
            const targetTrackIndex = playlistTracks.findIndex(t => t.id === trackId);
            if (targetTrackIndex !== -1) {
              if (player.currentTrack && player.currentTrack.id === trackId) {
                player.togglePlay();
              } else {
                player.activePlaylistId = playlist.id;
                player.activePlaylistName = playlist.name;
                await fileManager.incrementPlaylistPlayCount(playlist.id);
                playlists = await fileManager.getPlaylists();
                player.setQueue(playlistTracks, targetTrackIndex, true);
                player.updateNowPlayingUI();
              }
            }
          }
        } else {
          const targetTrackIndex = allTracks.findIndex(t => t.id === trackId);
          if (targetTrackIndex !== -1) {
            if (player.currentTrack && player.currentTrack.id === trackId) {
              player.togglePlay();
            } else {
              player.activePlaylistId = null;
              player.activePlaylistName = null;
              player.setQueue(allTracks, targetTrackIndex, true);
              player.updateNowPlayingUI();
            }
          }
        }
      }
    });
  }

  // Show Toast notification
  function showToast(msg) {
    if (!toastMessage) return;
    toastMessage.textContent = msg;
    toastMessage.classList.add('visible');
    setTimeout(() => {
      toastMessage.classList.remove('visible');
    }, 3000);
  }

  // Handle Adding Music folder or files from local storage (Non-destructive combined library)
  async function handleAddMusic() {
    try {
      let initialRendered = false;

      const newTracks = await fileManager.selectDirectory({
        onScanStart: () => {
          showLoadingProgress(0, 0);
        },
        onInitialTracksReady: (initialBatch) => {
          if (initialBatch && initialBatch.length > 0) {
            // MERGE with existing without wiping previous tracks
            const existingIds = new Set(allTracks.map(t => t.id));
            const existingKeys = new Set(allTracks.map(t => `${t.fileBlob?.name || t.title}_${t.fileBlob?.size || 0}`));
            const uniqueBatch = initialBatch.filter(t => {
              const key = `${t.fileBlob?.name || t.title}_${t.fileBlob?.size || 0}`;
              return !existingIds.has(t.id) && !existingKeys.has(key);
            });
            allTracks = [...allTracks, ...uniqueBatch];
            FileManager.sortTracks(allTracks);
            if (currentView === 'all_songs') {
              renderSongList();
            }
            initialRendered = true;

            // Prepare first track if queue is empty
            if (!player.currentTrack && allTracks.length > 0) {
              player.setQueue(allTracks, 0, false);
            }
          }
        },
        onProgress: ({ processed, total, remaining, percent }) => {
          showLoadingProgress(remaining, percent);
        },
        onBatchMetadataUpdated: (updatedChunk) => {
          updateVisibleSongCardMetadata(updatedChunk);
          if (player.currentTrack && updatedChunk.some(t => t.id === player.currentTrack.id)) {
            player.updateNowPlayingUI();
          }
        }
      });

      hideLoadingProgress();

      if (!initialRendered && newTracks && newTracks.length > 0) {
        const existingIds = new Set(allTracks.map(t => t.id));
        const existingKeys = new Set(allTracks.map(t => `${t.fileBlob?.name || t.title}_${t.fileBlob?.size || 0}`));
        const uniqueNew = newTracks.filter(t => {
          const key = `${t.fileBlob?.name || t.title}_${t.fileBlob?.size || 0}`;
          return !existingIds.has(t.id) && !existingKeys.has(key);
        });
        allTracks = [...allTracks, ...uniqueNew];
        FileManager.sortTracks(allTracks);
        if (currentView === 'all_songs') {
          renderSongList();
        }
        if (!player.currentTrack && allTracks.length > 0) {
          player.setQueue(allTracks, 0, false);
        }
      }

      if (newTracks && newTracks.length > 0) {
        showToast(`Imported ${newTracks.length} song${newTracks.length > 1 ? 's' : ''}!`);
      }
    } catch (err) {
      hideLoadingProgress();
      console.warn('Folder selection canceled or error:', err);
    }
  }

  if (addFolderBtn) {
    addFolderBtn.addEventListener('click', handleAddMusic);
  }

  // Player control buttons (Desktop & Mobile)
  const allPlayPauseBtns = [playPauseBtn, document.getElementById('mobilePopupPlayPauseBtn'), document.getElementById('mobileFullPlayPauseBtn')];
  allPlayPauseBtns.forEach(btn => {
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (allTracks.length === 0) {
          handleAddMusic();
        } else {
          player.togglePlay();
        }
      });
    }
  });

  const allPrevBtns = [prevBtn, document.getElementById('mobilePopupPrevBtn'), document.getElementById('mobileFullPrevBtn')];
  allPrevBtns.forEach(btn => {
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        player.prev();
      });
    }
  });

  const allNextBtns = [nextBtn, document.getElementById('mobilePopupNextBtn'), document.getElementById('mobileFullNextBtn')];
  allNextBtns.forEach(btn => {
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        player.next();
      });
    }
  });

  // Filter Pill Buttons: All, Column, Shuffle (Desktop & Mobile Synchronized)
  function setAllFilter() {
    currentFilter = 'all';
    isGridView = false;
    currentView = 'all_songs';
    activePlaylistId = null;

    // Reset search state & input
    searchQuery = '';
    document.querySelectorAll('.search-input').forEach(input => { input.value = ''; });
    document.querySelectorAll('.search-overlay').forEach(overlay => { overlay.classList.remove('open'); });
    if (searchInput) searchInput.value = '';
    if (searchOverlay) searchOverlay.classList.remove('open');
    isSearchHistoryActive = false;
    if (window.history && window.history.state && window.history.state.isSearch) {
      try {
        window.history.replaceState(null, '');
      } catch (e) {}
    }

    // Synchronize navbar active states
    document.querySelectorAll('.menu-item-btn').forEach(b => b.classList.toggle('active', b.dataset.action === 'all-songs'));
    document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.action === 'all-songs'));

    // Reset Library Heading
    const libraryHeading = document.querySelector('.library-heading');
    if (libraryHeading) libraryHeading.textContent = 'Songs';

    // PC Left side: Show normal player body
    const playerBody = document.querySelector('.player-body');
    if (playerBody) playerBody.classList.remove('playlist-view-active');

    ['filterAllBtn', 'mobileFilterAllBtn', 'mobileFullFilterAllBtn'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.classList.add('active');
    });
    ['filterColumnBtn', 'mobileFilterColumnBtn', 'mobileFullFilterColumnBtn'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.classList.remove('active');
    });
    renderSongList();
  }

  function toggleColumnFilter() {
    isGridView = !isGridView;
    ['filterColumnBtn', 'mobileFilterColumnBtn', 'mobileFullFilterColumnBtn'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.classList.toggle('active', isGridView);
    });
    ['filterAllBtn', 'mobileFilterAllBtn', 'mobileFullFilterAllBtn'].forEach(id => {
      const b = document.getElementById(id);
      if (b) {
        if (!isGridView) b.classList.add('active');
        else b.classList.remove('active');
      }
    });
    renderSongList();
  }

  function toggleShuffleFilter() {
    const isShuffled = player.toggleShuffle();
    showToast(isShuffled ? 'Shuffle: ON' : 'Shuffle: OFF');
    if (window.updateMobileUpNextUI) window.updateMobileUpNextUI();
  }

  ['filterAllBtn', 'mobileFilterAllBtn', 'mobileFullFilterAllBtn'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', setAllFilter);
  });

  ['filterColumnBtn', 'mobileFilterColumnBtn', 'mobileFullFilterColumnBtn'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', toggleColumnFilter);
  });

  ['filterShuffleBtn', 'mobileFilterShuffleBtn', 'mobileFullFilterShuffleBtn'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', toggleShuffleFilter);
  });

  // Mobile Side Controls (Black = Add Folder, Gray = Settings)
  const mobileSideAddBtn = document.getElementById('mobileSideAddBtn');
  if (mobileSideAddBtn) {
    mobileSideAddBtn.addEventListener('click', handleAddMusic);
  }

  const mobileSideSettingsBtn = document.getElementById('mobileSideSettingsBtn');
  if (mobileSideSettingsBtn) {
    mobileSideSettingsBtn.addEventListener('click', () => {
      if (settingsModal) settingsModal.classList.add('open');
    });
  }

  // Mobile Compact Popup (IMAGE 3) -> Opens Full Player on tap
  const mobileCompactPopup = document.getElementById('mobileCompactPopup');
  const mobileFullPlayer = document.getElementById('mobileFullPlayer');
  if (mobileCompactPopup && mobileFullPlayer) {
    mobileCompactPopup.addEventListener('click', (e) => {
      // Don't open if clicked on controls or progress bar
      if (e.target.closest('.mobile-popup-ctrl-btn') || e.target.closest('.mobile-popup-progress-track')) {
        return;
      }
      mobileFullPlayer.classList.add('open');
      requestAnimationFrame(() => {
        if (window.updateMobileUpNextUI) window.updateMobileUpNextUI();
      });
    });
  }

  // =========================================================================
  // RESPONSIVE UP NEXT SECTION & FULL-SCREEN PANEL (Images 2 & 3)
  // =========================================================================
  const mobileUpNextSection = document.getElementById('mobileUpNextSection');
  const mobileUpNextList = document.getElementById('mobileUpNextList');
  const mobileUpNextPanel = document.getElementById('mobileUpNextPanel');
  const mobileUpNextPanelHandle = document.getElementById('mobileUpNextPanelHandle');
  const mobileUpNextFullList = document.getElementById('mobileUpNextFullList');
  const mobileFullMainContent = document.getElementById('mobileFullMainContent');
  const mobileFullBody = document.getElementById('mobileFullBody');

  function getUpcomingTracks() {
    if (!player.queue || player.queue.length === 0 || !player.currentTrack) return [];
    
    // 1. REPEAT ONE SONG MODE: Show ONLY the currently playing song
    if (player.repeatMode === 'one') {
      return [player.currentTrack];
    }

    const currentIdx = player.currentIndex;
    if (currentIdx === -1) return player.queue;
    
    // 2. NORMAL MODE / SHUFFLE MODE: Songs following current song in active queue
    let upcoming = player.queue.slice(currentIdx + 1);
    
    // 3. REPEAT ALL MODE: Loop from beginning if at end of queue
    if (player.repeatMode === 'all' && upcoming.length === 0 && player.queue.length > 1) {
      upcoming = player.queue.slice(0, currentIdx);
    }
    
    return upcoming;
  }

  function renderUpNextCard(track) {
    const isFallback = !track.coverUrl || 
                       track.coverUrl.includes('M logo for music items') ||
                       track.coverUrl.includes('MlogoforMusicItems') ||
                       track.coverUrl.includes('Mlogo.png') || 
                       track.coverUrl.includes('Group 4') || 
                       track.coverUrl.trim() === '';
    const coverSrc = isFallback ? 'assets/M logo for music items.png' : track.coverUrl;

    return `
      <div class="mobile-up-next-card" data-id="${track.id}">
        <div class="song-card-left">
          <div class="song-thumb-wrapper">
            <img src="${coverSrc}" alt="${escapeHtml(track.title)}" class="song-thumb ${isFallback ? 'fallback-logo' : ''}" onerror="this.onerror=null;this.src='assets/M logo for music items.png';this.className='song-thumb fallback-logo';" />
          </div>
          <div class="song-info">
            <span class="song-title">${escapeHtml(track.title)}</span>
            <span class="song-artist">//${escapeHtml(track.artist || 'Unknown')}</span>
          </div>
        </div>
        <button class="song-options-btn" data-id="${track.id}" aria-label="Song options" title="Options">
          <img src="assets/OptionsThreeDots.svg" alt="Options" class="options-icon" />
        </button>
      </div>
    `;
  }

  function attachUpNextCardListeners(container) {
    if (!container) return;
    container.querySelectorAll('.mobile-up-next-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.song-options-btn')) return;
        const trackId = card.dataset.id;
        const targetIdx = player.queue.findIndex(t => t.id === trackId);
        if (targetIdx !== -1) {
          player.loadAndPlay(targetIdx);
          if (mobileUpNextPanel) {
            mobileUpNextPanel.classList.remove('open');
          }
        }
      });
    });

    container.querySelectorAll('.song-options-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const trackId = btn.dataset.id;
        showContextMenu(e, trackId);
      });
    });
  }

  function updateMobileUpNextUI() {
    if (!mobileUpNextSection || !mobileUpNextList || !mobileFullMainContent || !mobileFullBody) return;

    const upcoming = getUpcomingTracks();

    // 1. Populate Full-Screen Up Next Panel
    if (mobileUpNextFullList) {
      if (upcoming.length === 0) {
        mobileUpNextFullList.innerHTML = `<div class="up-next-empty">No upcoming songs in queue</div>`;
      } else {
        mobileUpNextFullList.innerHTML = upcoming.map(t => renderUpNextCard(t)).join('');
        attachUpNextCardListeners(mobileUpNextFullList);
      }
    }

    // 2. Calculate dynamic available vertical space for in-place section
    const bodyHeight = mobileFullBody.clientHeight;
    const mainHeight = mobileFullMainContent.offsetHeight;
    const availableHeight = bodyHeight - mainHeight;

    const isShortScreen = window.innerHeight <= 680;
    const cardHeightWithGap = isShortScreen ? 48 : 60;
    const headerHeight = isShortScreen ? 24 : 34;
    const minCardHeight = isShortScreen ? 42 : 52;

    if (upcoming.length === 0 || availableHeight < (headerHeight + minCardHeight)) {
      // STATE B: Compact "UP NEXT" bar (IMAGE 3)
      mobileUpNextSection.classList.add('compact-state');
      mobileUpNextList.innerHTML = '';
      return;
    }

    // STATE A: Enough Space -> Display as many items as comfortably fit (IMAGE 2)
    mobileUpNextSection.classList.remove('compact-state');
    const maxItemsFit = Math.max(1, Math.floor((availableHeight - headerHeight - 10) / cardHeightWithGap));
    const visibleUpcoming = upcoming.slice(0, maxItemsFit);

    mobileUpNextList.innerHTML = visibleUpcoming.map(t => renderUpNextCard(t)).join('');
    attachUpNextCardListeners(mobileUpNextList);
  }

  window.updateMobileUpNextUI = updateMobileUpNextUI;

  // Swipe Up gesture on Up Next section to open full-screen panel
  if (mobileUpNextSection && mobileUpNextPanel) {
    let upNextStartY = 0;
    let upNextCurrentY = 0;
    let isSwipingUpNext = false;

    mobileUpNextSection.addEventListener('touchstart', (e) => {
      upNextStartY = e.touches[0].clientY;
      upNextCurrentY = upNextStartY;
      isSwipingUpNext = true;
    }, { passive: true });

    mobileUpNextSection.addEventListener('touchmove', (e) => {
      if (!isSwipingUpNext) return;
      upNextCurrentY = e.touches[0].clientY;
    }, { passive: true });

    mobileUpNextSection.addEventListener('touchend', () => {
      if (isSwipingUpNext && (upNextStartY - upNextCurrentY > 35)) {
        mobileUpNextPanel.classList.add('open');
      }
      isSwipingUpNext = false;
      upNextStartY = 0;
      upNextCurrentY = 0;
    });

    // Tap anywhere on the Up Next bar opens the full Up Next panel (Change 4)
    mobileUpNextSection.addEventListener('click', (e) => {
      if (e.target.closest('.song-options-btn') || e.target.closest('.mobile-up-next-card')) {
        return;
      }
      mobileUpNextPanel.classList.add('open');
    });
  }

  // Swipe Down gesture on Full-Screen Up Next Panel to close it
  if (mobileUpNextPanel) {
    let panelStartY = 0;
    let panelCurrentY = 0;
    let isSwipingPanel = false;

    mobileUpNextPanel.addEventListener('touchstart', (e) => {
      if (!mobileUpNextFullList || mobileUpNextFullList.scrollTop <= 5) {
        panelStartY = e.touches[0].clientY;
        panelCurrentY = panelStartY;
        isSwipingPanel = true;
      } else {
        isSwipingPanel = false;
      }
    }, { passive: true });

    mobileUpNextPanel.addEventListener('touchmove', (e) => {
      if (!isSwipingPanel) return;
      panelCurrentY = e.touches[0].clientY;
      const deltaY = panelCurrentY - panelStartY;
      if (deltaY > 0) {
        mobileUpNextPanel.style.transform = `translateY(${Math.min(deltaY, 250)}px)`;
      }
    }, { passive: true });

    mobileUpNextPanel.addEventListener('touchend', () => {
      if (!isSwipingPanel) return;
      const deltaY = panelCurrentY - panelStartY;
      mobileUpNextPanel.style.transform = '';
      if (deltaY > 60) {
        mobileUpNextPanel.classList.remove('open');
      }
      isSwipingPanel = false;
      panelStartY = 0;
      panelCurrentY = 0;
    });

    if (mobileUpNextPanelHandle) {
      mobileUpNextPanelHandle.addEventListener('click', () => {
        mobileUpNextPanel.classList.remove('open');
      });
    }
  }

  // Mobile Swipe Down to Dismiss Full Player (IMAGE 2)
  const mobileSwipeHandle = document.getElementById('mobileSwipeHandle');
  if (mobileSwipeHandle && mobileFullPlayer) {
    mobileSwipeHandle.addEventListener('click', () => {
      mobileFullPlayer.classList.remove('open');
      if (mobileUpNextPanel) mobileUpNextPanel.classList.remove('open');
    });
  }

  if (mobileFullPlayer) {
    let startY = 0;
    let currentY = 0;
    let isSwiping = false;

    mobileFullPlayer.addEventListener('touchstart', (e) => {
      // Allow swipe down when at the top of scroll or touching header/art
      if (mobileFullPlayer.scrollTop <= 5 && (!mobileUpNextPanel || !mobileUpNextPanel.classList.contains('open'))) {
        startY = e.touches[0].clientY;
        isSwiping = true;
      } else {
        isSwiping = false;
      }
    }, { passive: true });

    mobileFullPlayer.addEventListener('touchmove', (e) => {
      if (!isSwiping) return;
      currentY = e.touches[0].clientY;
      const deltaY = currentY - startY;
      if (deltaY > 0) {
        mobileFullPlayer.style.transform = `translateY(${Math.min(deltaY, 200)}px)`;
      }
    }, { passive: true });

    mobileFullPlayer.addEventListener('touchend', () => {
      if (!isSwiping) return;
      const deltaY = currentY - startY;
      mobileFullPlayer.style.transform = '';
      if (deltaY > 70) {
        mobileFullPlayer.classList.remove('open');
        if (mobileUpNextPanel) mobileUpNextPanel.classList.remove('open');
      }
      isSwiping = false;
      startY = 0;
      currentY = 0;
    });
  }

  // Mobile Bottom Navigation Bar Action Handling
  document.querySelectorAll('.mobile-bottom-nav').forEach(nav => {
    nav.querySelectorAll('.mobile-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;

        // If inside full player and tapped all-songs or playlists, close full player
        if (mobileFullPlayer && (action === 'all-songs' || action === 'playlists')) {
          mobileFullPlayer.classList.remove('open');
        }

        if (action === 'delete') {
          if (allTracks.length > 0 && confirm('Clear all songs from library?')) {
            fileManager.clearAllTracks();
            allTracks = [];
            player.setQueue([], 0, false);
            renderSongList();
            showToast('Library cleared. No Songs.');
          } else if (allTracks.length === 0) {
            showToast('Library is already empty.');
          }
        } else if (action === 'all-songs' || action === 'home') {
          setAllFilter();
          showToast('All Songs');
        } else if (action === 'playlists') {
          renderPlaylistsView();
          showToast('Playlists');
        }
        // 'explore' and 'home' remain non-functional for now
      });
    });
  });

  // View selector dropdown
  if (viewSelectorPill && viewDropdownMenu) {
    viewSelectorPill.addEventListener('click', (e) => {
      e.stopPropagation();
      viewDropdownMenu.classList.toggle('open');
    });

    document.addEventListener('click', () => {
      viewDropdownMenu.classList.remove('open');
    });

    viewDropdownMenu.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const view = item.dataset.view;
        const text = item.textContent.trim();
        const label = document.getElementById('viewSelectorLabel');
        if (label) label.textContent = text;
        viewDropdownMenu.classList.remove('open');

        if (view === 'playlists') {
          renderPlaylistsView();
        } else if (view === 'albums') {
          toggleColumnFilter();
        } else {
          setAllFilter();
        }
        showToast(`View: ${text}`);
      });
    });
  }

  // Left Sidebar Menu Items navigation
  document.querySelectorAll('.menu-item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'delete') {
        if (allTracks.length > 0 && confirm('Clear all songs from library?')) {
          fileManager.clearAllTracks();
          allTracks = [];
          player.setQueue([], 0, false);
          renderSongList();
          showToast('Library cleared. No Songs.');
        } else if (allTracks.length === 0) {
          showToast('Library is already empty.');
        }
      } else if (action === 'playlists') {
        const label = document.getElementById('viewSelectorLabel');
        if (label) label.textContent = 'Playlists';
        renderPlaylistsView();
      } else if (action === 'all-songs' || action === 'home') {
        const label = document.getElementById('viewSelectorLabel');
        if (label) label.textContent = 'Home / All Songs';
        setAllFilter();
      }
      // 'explore' and 'home' remain non-functional for now
    });
  });

  const sidebarAllSongsBtn = document.getElementById('sidebarAllSongsBtn');
  if (sidebarAllSongsBtn) {
    sidebarAllSongsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const label = document.getElementById('viewSelectorLabel');
      if (label) label.textContent = 'Home / All Songs';
      setAllFilter();
    });
  }

  const logoBtn = document.getElementById('logoBtn');
  if (logoBtn) {
    logoBtn.addEventListener('click', () => {
      const label = document.getElementById('viewSelectorLabel');
      if (label) label.textContent = 'Home / All Songs';
      setAllFilter();
    });
  }

  // Top Horizontal Slider: Vertical Song-List Scroll Control
  let isDraggingSlider = false;

  function updateSongListScrollFromSlider(e) {
    if (!topSliderTrack || !songsListContainer) return;
    const rect = topSliderTrack.getBoundingClientRect();
    const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const percent = rect.width > 0 ? (x / rect.width) * 100 : 0;
    
    // Update thumb position on the horizontal bar
    if (topSliderThumb) {
      const thumbWidth = topSliderThumb.offsetWidth || 32;
      const maxLeft = Math.max(0, rect.width - thumbWidth - 4);
      const leftPx = (percent / 100) * maxLeft + 2;
      topSliderThumb.style.left = `${leftPx}px`;
    }

    // Scroll songs list vertically
    const maxScroll = Math.max(0, songsListContainer.scrollHeight - songsListContainer.clientHeight);
    if (maxScroll > 0) {
      songsListContainer.scrollTop = (percent / 100) * maxScroll;
      updateAlphabetScrollIndicator();
    }
  }

  function updateSliderThumbFromSongListScroll() {
    if (isDraggingSlider || !topSliderTrack || !topSliderThumb || !songsListContainer) return;
    const maxScroll = songsListContainer.scrollHeight - songsListContainer.clientHeight;
    const scrollPercent = maxScroll > 0 ? Math.min(100, Math.max(0, (songsListContainer.scrollTop / maxScroll) * 100)) : 0;
    const trackWidth = topSliderTrack.clientWidth || 300;
    const thumbWidth = topSliderThumb.offsetWidth || 32;
    const maxLeft = Math.max(0, trackWidth - thumbWidth - 4);
    const leftPx = (scrollPercent / 100) * maxLeft + 2;
    topSliderThumb.style.left = `${leftPx}px`;
  }

  // Mobile Vertical Scrollbar Logic (FIX 2: Real Mobile Custom Scrollbar with Black Track & Gray Thumb)
  const mobileScrollbarTrack = document.getElementById('mobileScrollbarTrack');
  const mobileScrollbarThumb = document.getElementById('mobileScrollbarThumb');
  let isDraggingMobileScrollbar = false;

  function updateMobileScrollbarThumb() {
    if (!mobileScrollbarTrack || !mobileScrollbarThumb || !songsListContainer) return;
    const maxScroll = songsListContainer.scrollHeight - songsListContainer.clientHeight;
    const trackHeight = mobileScrollbarTrack.clientHeight;

    if (maxScroll <= 0 || trackHeight <= 0) {
      mobileScrollbarThumb.style.height = `${Math.round(Math.min(58, Math.max(36, trackHeight * 0.22 * 1.8)))}px`;
      mobileScrollbarThumb.style.top = '2px';
      return;
    }

    // Thumb height scaled by 1.8x
    const visibleRatio = songsListContainer.clientHeight / songsListContainer.scrollHeight;
    const baseThumbHeight = Math.max(20, Math.min(trackHeight * 0.28, Math.max(24, visibleRatio * trackHeight * 0.32)));
    const thumbHeight = Math.round(baseThumbHeight * 1.8);
    mobileScrollbarThumb.style.height = `${thumbHeight}px`;

    const maxTop = Math.max(0, trackHeight - thumbHeight - 4);
    const scrollPercent = Math.min(1, Math.max(0, songsListContainer.scrollTop / maxScroll));
    const topPx = 2 + scrollPercent * maxTop;
    mobileScrollbarThumb.style.top = `${topPx}px`;
  }

  function handleMobileScrollbarMove(clientY) {
    if (!mobileScrollbarTrack || !songsListContainer) return;
    const rect = mobileScrollbarTrack.getBoundingClientRect();
    const trackHeight = rect.height;
    const thumbHeight = mobileScrollbarThumb ? mobileScrollbarThumb.clientHeight : 50;
    const maxTop = Math.max(1, trackHeight - thumbHeight - 4);
    
    // Position relative to track top, center thumb under finger
    const relativeY = clientY - rect.top - thumbHeight / 2;
    const clampedY = Math.max(0, Math.min(maxTop, relativeY));
    const scrollPercent = clampedY / maxTop;

    const maxScroll = songsListContainer.scrollHeight - songsListContainer.clientHeight;
    if (maxScroll > 0) {
      songsListContainer.scrollTop = scrollPercent * maxScroll;
    }
  }

  if (mobileScrollbarTrack) {
    mobileScrollbarTrack.addEventListener('touchstart', (e) => {
      isDraggingMobileScrollbar = true;
      handleMobileScrollbarMove(e.touches[0].clientY);
    }, { passive: false });

    mobileScrollbarTrack.addEventListener('mousedown', (e) => {
      isDraggingMobileScrollbar = true;
      handleMobileScrollbarMove(e.clientY);
    });
  }

  // Alphabetical Scroll Indicator for PC/Desktop view
  let alphabetFadeTimeout = null;

  function getVisibleAlphabetLetter() {
    if (!songsListContainer) return '';

    const containerRect = songsListContainer.getBoundingClientRect();
    const cards = songsListContainer.querySelectorAll('.song-card');

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const cardRect = card.getBoundingClientRect();
      // The first card whose bottom is below container top and top is within container
      if (cardRect.bottom > containerRect.top + 6 && cardRect.top < containerRect.bottom - 6) {
        const titleEl = card.querySelector('.song-title');
        let title = titleEl ? titleEl.textContent : '';
        if (!title) {
          const id = card.getAttribute('data-id');
          const t = allTracks.find(x => x.id === id);
          if (t) title = t.title || '';
        }
        if (title) {
          const clean = title.trim().replace(/^[^a-zA-Z0-9]+/, '');
          const char = (clean.charAt(0) || title.trim().charAt(0)).toUpperCase();
          if (char >= 'A' && char <= 'Z') return char;
          if (char >= '0' && char <= '9') return char;
          return '#';
        }
      }
    }

    // Fallback: direct index estimation based on scroll position in allTracks
    if (allTracks && allTracks.length > 0) {
      const maxScroll = Math.max(1, songsListContainer.scrollHeight - songsListContainer.clientHeight);
      const ratio = Math.max(0, Math.min(1, songsListContainer.scrollTop / maxScroll));
      const idx = Math.min(allTracks.length - 1, Math.floor(ratio * allTracks.length));
      const track = allTracks[idx];
      if (track && track.title) {
        const clean = track.title.trim().replace(/^[^a-zA-Z0-9]+/, '');
        const char = (clean.charAt(0) || track.title.trim().charAt(0)).toUpperCase();
        if (char >= 'A' && char <= 'Z') return char;
        if (char >= '0' && char <= '9') return char;
        return '#';
      }
    }

    return '';
  }

  function updateAlphabetScrollIndicator(isScrolling = true) {
    const alphabetIndicator = document.getElementById('alphabetScrollIndicator');
    if (!alphabetIndicator || !songsListContainer || window.innerWidth <= 768) return;

    if (currentView !== 'all_songs' || !allTracks || allTracks.length === 0) {
      alphabetIndicator.classList.remove('visible', 'scrolling');
      return;
    }

    const letter = getVisibleAlphabetLetter();
    if (letter) {
      alphabetIndicator.textContent = letter;
      alphabetIndicator.classList.add('visible');
      if (isScrolling) {
        alphabetIndicator.classList.add('scrolling');
      }

      if (alphabetFadeTimeout) {
        clearTimeout(alphabetFadeTimeout);
      }
      alphabetFadeTimeout = setTimeout(() => {
        alphabetIndicator.classList.remove('scrolling');
        alphabetIndicator.classList.remove('visible');
      }, 1500);
    }
  }

  if (songsListContainer) {
    songsListContainer.addEventListener('scroll', () => {
      updateSliderThumbFromSongListScroll();
      updateMobileScrollbarThumb();
      updateAlphabetScrollIndicator(true);
    }, { passive: true });

    songsListContainer.addEventListener('wheel', () => {
      updateAlphabetScrollIndicator(true);
    }, { passive: true });

    songsListContainer.addEventListener('mouseenter', () => {
      updateAlphabetScrollIndicator(false);
    });
  }

  window.addEventListener('resize', () => {
    updateSliderThumbFromSongListScroll();
    updateMobileScrollbarThumb();
    if (window.updateMobileUpNextUI) window.updateMobileUpNextUI();
  });

  if (topSliderTrack) {
    topSliderTrack.addEventListener('mousedown', (e) => {
      isDraggingSlider = true;
      updateSongListScrollFromSlider(e);
    });

    topSliderTrack.addEventListener('touchstart', (e) => {
      isDraggingSlider = true;
      updateSongListScrollFromSlider(e);
    }, { passive: true });
  }

  window.addEventListener('mousemove', (e) => {
    if (isDraggingSlider) updateSongListScrollFromSlider(e);
    if (isDraggingMobileScrollbar) handleMobileScrollbarMove(e.clientY);
  });

  window.addEventListener('touchmove', (e) => {
    if (isDraggingSlider) updateSongListScrollFromSlider(e);
    if (isDraggingMobileScrollbar) {
      e.preventDefault();
      handleMobileScrollbarMove(e.touches[0].clientY);
    }
  }, { passive: false });

  window.addEventListener('mouseup', () => {
    if (isDraggingSlider) isDraggingSlider = false;
    if (isDraggingMobileScrollbar) isDraggingMobileScrollbar = false;
  });

  window.addEventListener('touchend', () => {
    if (isDraggingSlider) isDraggingSlider = false;
    if (isDraggingMobileScrollbar) isDraggingMobileScrollbar = false;
  });

  // Dedicated Audio Timeline Seek Handlers (Desktop & Mobile)
  if (progressBarContainer) {
    progressBarContainer.addEventListener('click', (e) => {
      const rect = progressBarContainer.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const percent = (x / rect.width) * 100;
      player.seek(percent);
    });
  }

  const mobilePopupProgressTrack = document.getElementById('mobilePopupProgressTrack');
  if (mobilePopupProgressTrack) {
    mobilePopupProgressTrack.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = mobilePopupProgressTrack.getBoundingClientRect();
      const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const percent = (x / rect.width) * 100;
      player.seek(percent);
    });
  }

  const mobileFullProgressBarContainer = document.getElementById('mobileFullProgressBarContainer');
  if (mobileFullProgressBarContainer) {
    mobileFullProgressBarContainer.addEventListener('click', (e) => {
      const rect = mobileFullProgressBarContainer.getBoundingClientRect();
      const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const percent = (x / rect.width) * 100;
      player.seek(percent);
    });
  }

  // Search Modal / Input (Desktop & Mobile buttons)
  const allSearchBtns = [searchBtn, document.getElementById('mobileSearchBtn')];
  allSearchBtns.forEach(btn => {
    if (btn && searchOverlay) {
      btn.addEventListener('click', () => {
        searchOverlay.classList.add('open');
        enterSearchHistory();
        if (searchInput) {
          searchInput.focus();
          searchInput.value = searchQuery;
        }
      });
    }
  });

  if (closeSearchBtn && searchOverlay) {
    closeSearchBtn.addEventListener('click', () => {
      searchOverlay.classList.remove('open');
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderSongList();
      if (searchQuery.trim().length > 0) {
        enterSearchHistory();
      }
    });
  }

  // Settings Modal (Desktop & Mobile Side Button)
  const allSettingsBtns = [settingsBtn, document.getElementById('mobileSideSettingsBtn')];
  allSettingsBtns.forEach(btn => {
    if (btn && settingsModal) {
      btn.addEventListener('click', () => {
        settingsModal.classList.add('open');
      });
    }
  });

  if (closeSettingsBtn && settingsModal) {
    closeSettingsBtn.addEventListener('click', () => {
      settingsModal.classList.remove('open');
    });
  }

  // Theme Switching Logic
  function applyTheme(theme) {
    currentTheme = theme === 'dark' ? 'dark' : 'light';
    document.body.setAttribute('data-theme', currentTheme);
    localStorage.setItem('musico-theme', currentTheme);

    const themeLightBtn = document.getElementById('themeLightBtn');
    const themeDarkBtn = document.getElementById('themeDarkBtn');
    if (themeLightBtn) themeLightBtn.classList.toggle('active', currentTheme === 'light');
    if (themeDarkBtn) themeDarkBtn.classList.toggle('active', currentTheme === 'dark');

    const isDark = currentTheme === 'dark';

    // Update Search icons
    document.querySelectorAll('#searchBtn img, #mobileSearchBtn img').forEach(img => {
      img.src = isDark ? 'assets/Dark Mode/DarkModeSearchIcon.png' : 'assets/Search.png';
    });

    // Update Settings icon in desktop header
    document.querySelectorAll('#settingsBtn img').forEach(img => {
      img.src = isDark ? 'assets/Dark Mode/DarkModeSettings.png' : 'assets/Settings.png';
    });

    // Update Now Playing cover 3-dots
    document.querySelectorAll('#nowPlayingOptionsBtn img, #mobileFullOptionsBtn img').forEach(img => {
      img.src = isDark ? 'assets/Dark Mode/DarkModeOptions 3 Dots.svg' : 'assets/Options 3 Dots.svg';
    });

    // Update Prev buttons
    document.querySelectorAll('#prevBtn img, #mobileFullPrevBtn img, #mobilePopupPrevBtn img').forEach(img => {
      img.src = isDark ? 'assets/Dark Mode/DarkModePrevBtn.svg' : 'assets/Prevbtn.svg';
    });

    // Update Next buttons
    document.querySelectorAll('#nextBtn img, #mobileFullNextBtn img, #mobilePopupNextBtn img').forEach(img => {
      img.src = isDark ? 'assets/Dark Mode/DarkModeNxtBtn.svg' : 'assets/Nxtbtn.svg';
    });

    renderSongList();
  }

  const themeLightBtn = document.getElementById('themeLightBtn');
  const themeDarkBtn = document.getElementById('themeDarkBtn');
  if (themeLightBtn) {
    themeLightBtn.addEventListener('click', () => {
      applyTheme('light');
      showToast('Switched to Light Mode');
    });
  }
  if (themeDarkBtn) {
    themeDarkBtn.addEventListener('click', () => {
      applyTheme('dark');
      showToast('Switched to Dark Mode');
    });
  }

  // Close modals when clicking backdrop
  window.addEventListener('click', (e) => {
    if (e.target === searchOverlay) searchOverlay.classList.remove('open');
    if (e.target === settingsModal) settingsModal.classList.remove('open');
    if (playlistModal && e.target === playlistModal) closePlaylistModal();
    if (contextMenu) contextMenu.classList.remove('open');
    if (playlistContextMenu) playlistContextMenu.classList.remove('open');
  });

  // Mobile Back Button / Gesture Navigation (Search Results -> Back -> All Songs)
  window.addEventListener('popstate', () => {
    if (isSearchHistoryActive || (searchOverlay && searchOverlay.classList.contains('open')) || searchQuery.trim().length > 0) {
      isSearchHistoryActive = false;
      setAllFilter();
    }
  });

  // Context Menu for song options
  let contextTrackId = null;
  let contextIsInPlaylist = false;

  function showContextMenu(e, trackId, isInPlaylist = false) {
    contextTrackId = trackId;
    contextIsInPlaylist = isInPlaylist || (currentView === 'playlist_songs');
    if (!contextMenu) return;

    const removeFromPlBtn = document.getElementById('contextRemoveFromPlaylistBtn');
    if (removeFromPlBtn) {
      removeFromPlBtn.style.display = contextIsInPlaylist ? 'block' : 'none';
    }

    let clientX = e.clientX;
    let clientY = e.clientY;
    if ((clientX === undefined || clientY === undefined) && e.touches && e.touches[0]) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }
    if (clientX === undefined || clientY === undefined) {
      const target = e.currentTarget || e.target;
      if (target && target.getBoundingClientRect) {
        const r = target.getBoundingClientRect();
        clientX = r.left + r.width / 2;
        clientY = r.bottom;
      } else {
        clientX = window.innerWidth / 2;
        clientY = window.innerHeight / 2;
      }
    }

    const x = Math.min(window.innerWidth - 190, Math.max(10, clientX - 80));
    const y = Math.min(window.innerHeight - 250, Math.max(10, clientY + 8));

    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.add('open');
  }

  // Playlist context menu for 3-dots on playlist cards
  const playlistContextMenu = document.getElementById('playlistContextMenu');
  function showPlaylistContextMenu(e, playlistId) {
    playlistContextMenuTargetId = playlistId;
    if (!playlistContextMenu) return;

    let clientX = e.clientX;
    let clientY = e.clientY;
    if ((clientX === undefined || clientY === undefined) && e.touches && e.touches[0]) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }
    if (clientX === undefined || clientY === undefined) {
      const target = e.currentTarget || e.target;
      if (target && target.getBoundingClientRect) {
        const r = target.getBoundingClientRect();
        clientX = r.left + r.width / 2;
        clientY = r.bottom;
      } else {
        clientX = window.innerWidth / 2;
        clientY = window.innerHeight / 2;
      }
    }

    const x = Math.min(window.innerWidth - 190, Math.max(10, clientX - 80));
    const y = Math.min(window.innerHeight - 200, Math.max(10, clientY + 8));

    playlistContextMenu.style.left = `${x}px`;
    playlistContextMenu.style.top = `${y}px`;
    playlistContextMenu.classList.add('open');
  }

  // Now Playing cover image 3-dot options buttons (PC & Mobile)
  const nowPlayingOptionsBtn = document.getElementById('nowPlayingOptionsBtn');
  const mobileFullOptionsBtn = document.getElementById('mobileFullOptionsBtn');
  [nowPlayingOptionsBtn, mobileFullOptionsBtn].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (player.currentTrack) {
          showContextMenu(e, player.currentTrack.id, currentView === 'playlist_songs');
        } else {
          showToast('No song is currently playing');
        }
      });
    }
  });

  // Song Context Menu Actions
  document.querySelectorAll('#songContextMenu .context-item').forEach(item => {
    item.addEventListener('click', async () => {
      const action = item.dataset.action;
      if (!contextTrackId) return;

      const track = allTracks.find(t => t.id === contextTrackId);
      if (!track) return;

      if (action === 'select') {
        openSelectMode(contextTrackId);
      } else if (action === 'add-to-playlist') {
        openAddToPlaylistModal([contextTrackId]);
      } else if (action === 'remove-from-playlist') {
        if (activePlaylistId) {
          const playlist = playlists.find(p => p.id === activePlaylistId);
          await fileManager.removeTrackFromPlaylist(activePlaylistId, contextTrackId);
          playlists = await fileManager.getPlaylists();
          renderPlaylistSongsView(activePlaylistId);
          showToast(`Removed "${track.title}" from "${playlist ? playlist.name : 'playlist'}"`);
        }
      } else if (action === 'play-next') {
        const currentIdx = player.currentIndex;
        const targetIdx = allTracks.findIndex(t => t.id === contextTrackId);
        if (targetIdx !== -1) {
          const [moved] = allTracks.splice(targetIdx, 1);
          allTracks.splice(currentIdx + 1, 0, moved);
          player.setQueue(allTracks, player.currentIndex, false);
          if (currentView === 'all_songs') renderSongList();
          showToast(`"${track.title}" will play next`);
        }
      } else if (action === 'info') {
        alert(`Title: ${track.title}\nArtist: ${track.artist || 'Unknown'}\nAlbum: ${track.album || 'Unknown'}\nDuration: ${track.formattedDuration || 'Unknown'}`);
      } else if (action === 'delete') {
        if (confirm(`Remove "${track.title}" from library?`)) {
          fileManager.deleteTrackFromDB(track.id);
          if (track.id === localStorage.getItem('musico-last-played-id')) {
            localStorage.removeItem('musico-last-played-id');
          }
          allTracks = allTracks.filter(t => t.id !== track.id);
          if (allTracks.length === 0) {
            player.setQueue([], 0, false);
          }
          if (currentView === 'all_songs') renderSongList();
          showToast(`Removed "${track.title}"`);
        }
      }
      contextMenu.classList.remove('open');
    });
  });

  // Playlist Context Menu Actions
  if (playlistContextMenu) {
    playlistContextMenu.querySelectorAll('.context-item').forEach(item => {
      item.addEventListener('click', async () => {
        const action = item.dataset.action;
        if (!playlistContextMenuTargetId) return;

        const playlist = playlists.find(p => p.id === playlistContextMenuTargetId);
        if (!playlist) return;

        if (action === 'play-playlist') {
          const playlistTracks = (playlist.trackIds || []).map(id => allTracks.find(t => t.id === id)).filter(Boolean);
          if (playlistTracks.length === 0) {
            showToast('Playlist is empty');
          } else {
            player.activePlaylistId = playlist.id;
            player.activePlaylistName = playlist.name;
            await fileManager.incrementPlaylistPlayCount(playlist.id);
            playlists = await fileManager.getPlaylists();
            player.setQueue(playlistTracks, 0, true);
            player.updateNowPlayingUI();
            showToast(`Playing playlist "${playlist.name}"`);
          }
        } else if (action === 'rename-playlist') {
          const newName = prompt('Enter new playlist name:', playlist.name);
          if (newName && newName.trim() && newName.trim() !== playlist.name) {
            playlist.name = newName.trim();
            await fileManager.savePlaylist(playlist);
            playlists = await fileManager.getPlaylists();
            renderPlaylistsView();
            showToast(`Renamed to "${playlist.name}"`);
          }
        } else if (action === 'delete-playlist') {
          if (confirm(`Delete playlist "${playlist.name}"? (Songs will remain in your library)`)) {
            await fileManager.deletePlaylist(playlist.id);
            playlists = await fileManager.getPlaylists();
            renderPlaylistsView();
            showToast(`Deleted playlist "${playlist.name}"`);
          }
        }
        playlistContextMenu.classList.remove('open');
      });
    });
  }

  // =========================================================================
  // MULTI-SELECTION MODE CONTROLS
  // =========================================================================
  function openSelectMode(initialTrackId) {
    isSelectMode = true;
    selectedTrackIds.clear();
    if (initialTrackId) {
      selectedTrackIds.add(initialTrackId);
    }
    updateMultiSelectUI();
  }

  function exitSelectMode() {
    isSelectMode = false;
    selectedTrackIds.clear();
    updateMultiSelectUI();
  }

  function updateMultiSelectUI() {
    const bar = document.getElementById('multiSelectActionBar');
    const count = document.getElementById('multiSelectCount');
    if (bar) bar.classList.toggle('visible', isSelectMode);
    if (count) count.textContent = selectedTrackIds.size;

    if (songsListContainer) {
      songsListContainer.classList.toggle('select-mode', isSelectMode);
      songsListContainer.querySelectorAll('.song-card').forEach(card => {
        const id = card.dataset.id;
        card.classList.toggle('selected', selectedTrackIds.has(id));
      });
    }
  }

  const multiSelectAllBtn = document.getElementById('multiSelectAllBtn');
  if (multiSelectAllBtn) {
    multiSelectAllBtn.addEventListener('click', () => {
      let currentList = allTracks;
      if (currentView === 'playlist_songs' && activePlaylistId) {
        const pl = playlists.find(p => p.id === activePlaylistId);
        if (pl) currentList = (pl.trackIds || []).map(id => allTracks.find(t => t.id === id)).filter(Boolean);
      }
      if (selectedTrackIds.size === currentList.length) {
        selectedTrackIds.clear();
      } else {
        currentList.forEach(t => selectedTrackIds.add(t.id));
      }
      updateMultiSelectUI();
    });
  }

  const multiSelectCancelBtn = document.getElementById('multiSelectCancelBtn');
  if (multiSelectCancelBtn) {
    multiSelectCancelBtn.addEventListener('click', () => {
      exitSelectMode();
    });
  }

  const multiSelectAddBtn = document.getElementById('multiSelectAddBtn');
  if (multiSelectAddBtn) {
    multiSelectAddBtn.addEventListener('click', () => {
      if (selectedTrackIds.size === 0) {
        showToast('Please select at least one song');
        return;
      }
      openAddToPlaylistModal(Array.from(selectedTrackIds));
    });
  }

  // =========================================================================
  // ADD TO PLAYLIST MODAL & QUICK CREATE CONTROLS
  // =========================================================================
  const playlistModal = document.getElementById('playlistModal');
  const closePlaylistModalBtn = document.getElementById('closePlaylistModalBtn');
  const showCreatePlaylistBtn = document.getElementById('showCreatePlaylistBtn');
  const createPlaylistInputBox = document.getElementById('createPlaylistInputBox');
  const newPlaylistNameInput = document.getElementById('newPlaylistNameInput');
  const confirmCreatePlaylistBtn = document.getElementById('confirmCreatePlaylistBtn');
  const cancelCreatePlaylistBtn = document.getElementById('cancelCreatePlaylistBtn');
  const playlistSelectList = document.getElementById('playlistSelectList');

  function openAddToPlaylistModal(trackIds = []) {
    modalPendingTrackIds = Array.isArray(trackIds) ? trackIds : [trackIds];
    if (!playlistModal) return;

    if (createPlaylistInputBox) createPlaylistInputBox.style.display = 'none';
    if (showCreatePlaylistBtn) showCreatePlaylistBtn.style.display = 'block';
    if (newPlaylistNameInput) newPlaylistNameInput.value = '';

    renderPlaylistSelectList();
    playlistModal.classList.add('open');
  }

  function closePlaylistModal() {
    if (playlistModal) playlistModal.classList.remove('open');
    modalPendingTrackIds = [];
  }

  function renderPlaylistSelectList() {
    if (!playlistSelectList) return;
    if (playlists.length === 0) {
      playlistSelectList.innerHTML = `<div class="playlist-select-empty">No playlists created yet.<br>Click the button above to create one!</div>`;
      return;
    }

    playlistSelectList.innerHTML = playlists.map(p => {
      const count = p.trackIds ? p.trackIds.length : 0;
      return `
        <div class="playlist-select-item" data-playlist-id="${p.id}">
          <span class="playlist-select-name">${escapeHtml(p.name)}</span>
          <span class="playlist-select-count">${count} song${count === 1 ? '' : 's'}</span>
        </div>
      `;
    }).join('');

    playlistSelectList.querySelectorAll('.playlist-select-item').forEach(item => {
      item.addEventListener('click', async () => {
        const id = item.dataset.playlistId;
        const targetPl = playlists.find(p => p.id === id);
        if (targetPl && modalPendingTrackIds.length > 0) {
          await fileManager.addTracksToPlaylist(id, modalPendingTrackIds);
          playlists = await fileManager.getPlaylists();
          closePlaylistModal();
          exitSelectMode();
          showToast(`Added ${modalPendingTrackIds.length} song${modalPendingTrackIds.length > 1 ? 's' : ''} to "${targetPl.name}"`);
          if (currentView === 'playlists') {
            renderPlaylistsView();
          } else if (currentView === 'playlist_songs' && activePlaylistId === id) {
            renderPlaylistSongsView(id);
          }
        }
      });
    });
  }

  function openCreatePlaylistModal() {
    openAddToPlaylistModal([]);
    if (showCreatePlaylistBtn) showCreatePlaylistBtn.style.display = 'none';
    if (createPlaylistInputBox) {
      createPlaylistInputBox.style.display = 'flex';
      if (newPlaylistNameInput) {
        newPlaylistNameInput.focus();
      }
    }
  }

  if (closePlaylistModalBtn) {
    closePlaylistModalBtn.addEventListener('click', closePlaylistModal);
  }

  if (showCreatePlaylistBtn && createPlaylistInputBox) {
    showCreatePlaylistBtn.addEventListener('click', () => {
      showCreatePlaylistBtn.style.display = 'none';
      createPlaylistInputBox.style.display = 'flex';
      if (newPlaylistNameInput) {
        newPlaylistNameInput.value = '';
        newPlaylistNameInput.focus();
      }
    });
  }

  if (cancelCreatePlaylistBtn && showCreatePlaylistBtn && createPlaylistInputBox) {
    cancelCreatePlaylistBtn.addEventListener('click', () => {
      createPlaylistInputBox.style.display = 'none';
      showCreatePlaylistBtn.style.display = 'block';
    });
  }

  async function handleConfirmCreatePlaylist() {
    if (!newPlaylistNameInput) return;
    const name = newPlaylistNameInput.value.trim();
    if (!name) {
      showToast('Please enter a playlist name');
      return;
    }

    const newPlaylist = {
      id: 'pl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      name: name,
      trackIds: [...modalPendingTrackIds],
      playCount: 0,
      createdAt: Date.now()
    };

    await fileManager.savePlaylist(newPlaylist);
    playlists = await fileManager.getPlaylists();
    closePlaylistModal();
    exitSelectMode();

    if (modalPendingTrackIds.length > 0) {
      showToast(`Created playlist "${name}" with ${modalPendingTrackIds.length} song${modalPendingTrackIds.length > 1 ? 's' : ''}`);
    } else {
      showToast(`Created playlist "${name}"`);
    }

    if (currentView === 'playlists') {
      renderPlaylistsView();
    }
  }

  if (confirmCreatePlaylistBtn) {
    confirmCreatePlaylistBtn.addEventListener('click', handleConfirmCreatePlaylist);
  }

  if (newPlaylistNameInput) {
    newPlaylistNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleConfirmCreatePlaylist();
      }
    });
  }

  // Settings Preset controls
  const eqPresets = document.querySelectorAll('.eq-preset-btn');
  eqPresets.forEach(btn => {
    btn.addEventListener('click', () => {
      eqPresets.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showToast(`Equalizer Preset: ${btn.textContent.trim()}`);
    });
  });

  const clearLibraryBtn = document.getElementById('clearLibrarySettingsBtn');
  if (clearLibraryBtn) {
    clearLibraryBtn.addEventListener('click', async () => {
      if (confirm('Clear all imported songs?')) {
        await fileManager.clearAllTracks();
        localStorage.removeItem('musico-last-played-id');
        allTracks = [];
        player.setQueue([], 0, false);
        renderSongList();
        settingsModal.classList.remove('open');
        showToast('Library cleared. No Songs.');
      }
    });
  }

  // Volume slider in settings
  const settingsVolumeSlider = document.getElementById('settingsVolumeSlider');
  if (settingsVolumeSlider) {
    settingsVolumeSlider.value = player.volume * 100;
    settingsVolumeSlider.addEventListener('input', (e) => {
      player.setVolume(e.target.value / 100);
    });
  }

  // Drag and drop audio files onto window (Combined library)
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.body.classList.add('drag-over');
  });

  window.addEventListener('dragleave', (e) => {
    if (e.clientX === 0 || e.clientY === 0) {
      document.body.classList.remove('drag-over');
    }
  });

  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    document.body.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => 
      /\.(mp3|wav|ogg|flac|m4a|aac|opus|weba|webm)$/i.test(f.name) || f.type.startsWith('audio/')
    );

    if (files.length > 0) {
      showToast(`Importing ${files.length} dropped file${files.length > 1 ? 's' : ''}...`);
      const imported = await fileManager.processAudioFiles(files);
      if (imported.length > 0) {
        const existingIds = new Set(allTracks.map(t => t.id));
        const existingKeys = new Set(allTracks.map(t => `${t.fileBlob?.name || t.title}_${t.fileBlob?.size || 0}`));
        const uniqueImported = imported.filter(t => {
          const key = `${t.fileBlob?.name || t.title}_${t.fileBlob?.size || 0}`;
          return !existingIds.has(t.id) && !existingKeys.has(key);
        });
        allTracks = [...allTracks, ...uniqueImported];
        FileManager.sortTracks(allTracks);
        if (currentView === 'all_songs') {
          renderSongList();
        }
        showToast(`Added ${uniqueImported.length} song${uniqueImported.length > 1 ? 's' : ''}!`);
        if (!player.currentTrack && allTracks.length > 0) {
          player.setQueue(allTracks, 0, false);
        }
      }
    }
  });

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    if (e.code === 'Space') {
      e.preventDefault();
      if (allTracks.length === 0) {
        handleAddMusic();
      } else {
        player.togglePlay();
      }
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      player.seek(Math.min(100, ((player.audio.currentTime + 5) / (player.audio.duration || 1)) * 100));
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      player.seek(Math.max(0, ((player.audio.currentTime - 5) / (player.audio.duration || 1)) * 100));
    } else if (e.code === 'KeyN') {
      player.next();
    } else if (e.code === 'KeyP') {
      player.prev();
    } else if (e.code === 'KeyS') {
      filterShuffleBtn && filterShuffleBtn.click();
    }
  });

  // Helper to escape HTML strings
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Start app
  applyTheme(currentTheme);
  await initLibrary();

  // =========================================================================
  // SINGLE-INSTANCE WINDOW COORDINATOR (PC / Windows PWA)
  // Prevents opening duplicate windows when user launches Musico again.
  // =========================================================================
  if ('launchQueue' in window && 'setConsumer' in window.launchQueue) {
    window.launchQueue.setConsumer(() => {
      window.focus();
    });
  }

  if ('BroadcastChannel' in window) {
    try {
      const instanceChannel = new BroadcastChannel('musico_single_instance_coordinator');
      // Announce this launch event to any already-running instance
      instanceChannel.postMessage({ type: 'MUSICO_PING', timestamp: Date.now() });

      instanceChannel.onmessage = (event) => {
        if (!event.data) return;
        if (event.data.type === 'MUSICO_PING') {
          // Existing active window receives ping -> Focus window to bring it to front
          window.focus();
          // Inform the new window that an active instance already exists
          instanceChannel.postMessage({ type: 'MUSICO_ACTIVE_INSTANCE_EXISTS' });
        } else if (event.data.type === 'MUSICO_ACTIVE_INSTANCE_EXISTS') {
          // This duplicate window should close itself to enforce a single window
          window.close();
        }
      };
    } catch (e) {
      console.warn('Single-instance coordinator initialization error:', e);
    }
  }

  // Register PWA Service Worker for Offline / Standalone Installation
  if ('serviceWorker' in navigator && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
    const registerServiceWorker = () => {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(err => {
        console.warn('ServiceWorker registration error:', err);
      });
    };

    if (document.readyState === 'complete') {
      registerServiceWorker();
    } else {
      window.addEventListener('load', registerServiceWorker);
    }
  }
});
