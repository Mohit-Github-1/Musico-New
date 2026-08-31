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
  let currentView = 'all_songs';
  let searchQuery = '';

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

  // Initialize Library from IndexedDB
  async function initLibrary() {
    const savedTracks = await fileManager.loadStoredTracks();
    if (savedTracks && savedTracks.length > 0) {
      allTracks = [...savedTracks];
      renderSongList();
      player.setQueue(allTracks, 0, false);
    } else {
      allTracks = [];
      renderSongList();
      player.setQueue([], 0, false);
    }
  }

  // Render song cards in right panel
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
            <img src="assets/Addbtn.png" alt="Add Music" width="36" height="36" />
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

    songsListContainer.innerHTML = filtered.map((track, idx) => {
      const isCurrent = player.currentTrack && player.currentTrack.id === track.id;
      const isPlaying = isCurrent && player.isPlaying;
      const isFallback = !track.coverUrl || 
                         track.coverUrl.includes('M logo for music items') ||
                         track.coverUrl.includes('MlogoforMusicItems') ||
                         track.coverUrl.includes('Mlogo.png') || 
                         track.coverUrl.includes('Group 4') || 
                         track.coverUrl.trim() === '';
      const coverSrc = isFallback ? 'assets/M logo for music items.png' : track.coverUrl;

      return `
        <div class="song-card ${isCurrent ? 'active' : ''} ${isPlaying ? 'playing' : ''}" data-id="${track.id}" data-index="${idx}">
          <div class="song-card-left">
            <div class="song-thumb-wrapper">
              <img src="${coverSrc}" alt="${escapeHtml(track.title)}" class="song-thumb ${isFallback ? 'fallback-logo' : ''}" onerror="this.onerror=null;this.src='assets/M logo for music items.png';this.className='song-thumb fallback-logo';" />
              <div class="song-play-overlay">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
              </div>
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
    }).join('');

    // Attach click listeners to song cards
    songsListContainer.querySelectorAll('.song-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.song-options-btn')) return;
        const trackId = card.dataset.id;
        const targetTrackIndex = allTracks.findIndex(t => t.id === trackId);
        if (targetTrackIndex !== -1) {
          if (player.currentTrack && player.currentTrack.id === trackId) {
            player.togglePlay();
          } else {
            player.setQueue(allTracks, targetTrackIndex, true);
          }
        }
      });
    });

    // Attach listeners to three-dots option buttons
    songsListContainer.querySelectorAll('.song-options-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const trackId = btn.dataset.id;
        showContextMenu(e, trackId);
      });
    });

    // Update custom mobile scrollbar position
    requestAnimationFrame(updateMobileScrollbarThumb);
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

  // Handle Adding Music folder or files from local storage
  async function handleAddMusic() {
    showToast('Selecting music folder or files...');
    try {
      const newTracks = await fileManager.selectDirectory();
      if (newTracks && newTracks.length > 0) {
        allTracks = [...newTracks, ...allTracks];
        renderSongList();
        showToast(`Imported ${newTracks.length} song${newTracks.length > 1 ? 's' : ''}!`);
        // Prepare first track without autoplay (plays only upon user action - FIX 3)
        player.setQueue(allTracks, 0, false);
      }
    } catch (err) {
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

    const cardHeightWithGap = 60; // 52px card + 8px gap
    const headerHeight = 34;      // "Up Next" header height

    if (upcoming.length === 0 || availableHeight < (headerHeight + 52)) {
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
        document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const action = btn.dataset.action;

        // If inside full player and tapped home or library, close full player
        if (mobileFullPlayer && (action === 'home' || action === 'all-songs' || action === 'playlists' || action === 'albums')) {
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
        } else if (action === 'home' || action === 'all-songs') {
          setAllFilter();
          showToast('All Songs');
        } else if (action === 'playlists') {
          showToast('Playlists');
        } else if (action === 'albums') {
          toggleColumnFilter();
          showToast('Album View');
        }
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
        currentView = view;
        const text = item.textContent.trim();
        const label = document.getElementById('viewSelectorLabel');
        if (label) label.textContent = text;
        viewDropdownMenu.classList.remove('open');
        showToast(`View: ${text}`);
      });
    });
  }

  // Left Sidebar Menu Items navigation
  document.querySelectorAll('.menu-item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.menu-item-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
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
      } else if (action === 'home' || action === 'all-songs') {
        const label = document.getElementById('viewSelectorLabel');
        if (label) label.textContent = 'Home / All Songs';
        renderSongList();
      }
    });
  });

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
      const maxLeft = Math.max(0, rect.width - 30);
      const leftPx = (percent / 100) * maxLeft + 2;
      topSliderThumb.style.left = `${leftPx}px`;
    }

    // Scroll songs list vertically
    const maxScroll = Math.max(0, songsListContainer.scrollHeight - songsListContainer.clientHeight);
    if (maxScroll > 0) {
      songsListContainer.scrollTop = (percent / 100) * maxScroll;
    }
  }

  function updateSliderThumbFromSongListScroll() {
    if (isDraggingSlider || !topSliderTrack || !topSliderThumb || !songsListContainer) return;
    const maxScroll = songsListContainer.scrollHeight - songsListContainer.clientHeight;
    const scrollPercent = maxScroll > 0 ? Math.min(100, Math.max(0, (songsListContainer.scrollTop / maxScroll) * 100)) : 0;
    const trackWidth = topSliderTrack.clientWidth || 204;
    const maxLeft = Math.max(0, trackWidth - 30);
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
      mobileScrollbarThumb.style.height = `${Math.min(32, Math.max(20, trackHeight * 0.22))}px`;
      mobileScrollbarThumb.style.top = '2px';
      return;
    }

    // Shorter thumb height (less than half of previous size, compact as in Figma)
    const visibleRatio = songsListContainer.clientHeight / songsListContainer.scrollHeight;
    const thumbHeight = Math.max(20, Math.min(trackHeight * 0.28, Math.max(24, visibleRatio * trackHeight * 0.32)));
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
    const thumbHeight = mobileScrollbarThumb ? mobileScrollbarThumb.clientHeight : 28;
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

  if (songsListContainer) {
    songsListContainer.addEventListener('scroll', () => {
      updateSliderThumbFromSongListScroll();
      updateMobileScrollbarThumb();
    }, { passive: true });
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
    });
  }

  // Settings Modal
  if (settingsBtn && settingsModal) {
    settingsBtn.addEventListener('click', () => {
      settingsModal.classList.add('open');
    });
  }

  if (closeSettingsBtn && settingsModal) {
    closeSettingsBtn.addEventListener('click', () => {
      settingsModal.classList.remove('open');
    });
  }

  // Close modals when clicking backdrop
  window.addEventListener('click', (e) => {
    if (e.target === searchOverlay) searchOverlay.classList.remove('open');
    if (e.target === settingsModal) settingsModal.classList.remove('open');
    if (contextMenu) contextMenu.classList.remove('open');
  });

  // Context Menu for song options
  let contextTrackId = null;
  function showContextMenu(e, trackId) {
    contextTrackId = trackId;
    if (!contextMenu) return;

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

    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.add('open');
  }

  // Now Playing cover image 3-dot options buttons (PC & Mobile)
  const nowPlayingOptionsBtn = document.getElementById('nowPlayingOptionsBtn');
  const mobileFullOptionsBtn = document.getElementById('mobileFullOptionsBtn');
  [nowPlayingOptionsBtn, mobileFullOptionsBtn].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (player.currentTrack) {
          showContextMenu(e, player.currentTrack.id);
        } else {
          showToast('No song is currently playing');
        }
      });
    }
  });

  // Context Menu Actions
  document.querySelectorAll('.context-item').forEach(item => {
    item.addEventListener('click', () => {
      const action = item.dataset.action;
      if (!contextTrackId) return;

      const track = allTracks.find(t => t.id === contextTrackId);
      if (!track) return;

      if (action === 'play-next') {
        const currentIdx = player.currentIndex;
        const targetIdx = allTracks.findIndex(t => t.id === contextTrackId);
        if (targetIdx !== -1) {
          const [moved] = allTracks.splice(targetIdx, 1);
          allTracks.splice(currentIdx + 1, 0, moved);
          player.setQueue(allTracks, player.currentIndex, false);
          renderSongList();
          showToast(`"${track.title}" will play next`);
        }
      } else if (action === 'info') {
        alert(`Title: ${track.title}\nArtist: ${track.artist || 'Unknown'}\nAlbum: ${track.album || 'Unknown'}\nDuration: ${track.formattedDuration || 'Unknown'}`);
      } else if (action === 'delete') {
        if (confirm(`Remove "${track.title}" from library?`)) {
          fileManager.deleteTrackFromDB(track.id);
          allTracks = allTracks.filter(t => t.id !== track.id);
          if (allTracks.length === 0) {
            player.setQueue([], 0, false);
          }
          renderSongList();
          showToast(`Removed "${track.title}"`);
        }
      }
      contextMenu.classList.remove('open');
    });
  });

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

  // Drag and drop audio files onto window
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
        allTracks = [...imported, ...allTracks];
        renderSongList();
        showToast(`Added ${imported.length} song${imported.length > 1 ? 's' : ''}!`);
        // Prepare tracks without autoplay (FIX 3)
        player.setQueue(allTracks, 0, false);
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
  await initLibrary();

  // Register PWA Service Worker for Offline / Standalone Installation
  if ('serviceWorker' in navigator && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(err => {
        console.warn('ServiceWorker registration error:', err);
      });
    });
  }
});
