// ===== LangClip - YouTube Language Learning App =====

(function () {
  'use strict';

  // ===== State =====
  const STATE_KEY = 'langclip_data';
  let state = loadStateLocal();
  let player = null;
  let currentVideoId = null;
  let timeUpdateInterval = null;
  let editingBookmarkId = null;

  // Loop state
  let loopState = 'idle'; // 'idle' | 'a-set' | 'looping'
  let loopA = null;
  let loopB = null;

  // Subtitle state
  let subtitles = null;
  let subtitleCache = {};
  let lastActiveSubIdx = -1;
  const SUBTITLE_PROXY_URL = 'https://langclip-subtitles.syun-ohsaka.workers.dev';

  // Firebase state
  let currentUser = null;
  let isFirebaseConfigured = false;

  // Speed state
  const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  let currentSpeedIndex = 2; // default 1x

  // ===== DOM Elements =====
  const $ = (sel) => document.querySelector(sel);
  const videoUrlInput = $('#videoUrlInput');
  const loadVideoBtn = $('#loadVideoBtn');
  const playerSection = $('#playerSection');
  const bookmarksSection = $('#bookmarksSection');
  const currentTimeDisplay = $('#currentTime');
  const bookmarksList = $('#bookmarksList');
  const bookmarkCount = $('#bookmarkCount');
  const bookmarksEmpty = $('#bookmarksEmpty');
  const libraryList = $('#libraryList');
  const libraryEmpty = $('#libraryEmpty');

  // Modal elements
  const bookmarkModal = $('#bookmarkModal');
  const modalTime = $('#modalTime');
  const bookmarkNote = $('#bookmarkNote');
  const modalClose = $('#modalClose');
  const modalCancel = $('#modalCancel');
  const modalSave = $('#modalSave');

  const editModal = $('#editModal');
  const editModalTime = $('#editModalTime');
  const editBookmarkNote = $('#editBookmarkNote');
  const editModalClose = $('#editModalClose');
  const editModalCancel = $('#editModalCancel');
  const editModalSave = $('#editModalSave');

  // Loop elements
  const loopBtn = $('#loopBtn');
  const loopIndicator = $('#loopIndicator');
  const loopRange = $('#loopRange');
  const loopClear = $('#loopClear');

  // Speed elements
  const speedBtn = $('#speedBtn');
  const speedLabel = $('#speedLabel');

  // Subtitle elements
  const subtitlePanel = $('#subtitlePanel');
  const subtitleToggle = $('#subtitleToggle');
  const subtitleBody = $('#subtitleBody');
  const subtitleLoading = $('#subtitleLoading');
  const subtitleEmpty = $('#subtitleEmpty');
  const subtitleList = $('#subtitleList');

  // Auth elements
  const googleLoginBtn = $('#googleLoginBtn');
  const userInfo = $('#userInfo');
  const userAvatar = $('#userAvatar');
  const userName = $('#userName');
  const logoutBtn = $('#logoutBtn');

  // ===== Persistence =====
  function loadStateLocal() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      return raw ? JSON.parse(raw) : { videos: [] };
    } catch {
      return { videos: [] };
    }
  }

  function saveStateLocal() {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }

  function saveState() {
    saveStateLocal();
    if (currentUser && isFirebaseConfigured) {
      saveToFirestore();
    }
  }

  // ===== Firebase Auth =====
  function checkFirebase() {
    try {
      if (typeof firebase !== 'undefined' && window.__FIREBASE_CONFIGURED__) {
        isFirebaseConfigured = true;
        setupAuthListener();
      }
    } catch (e) {
      isFirebaseConfigured = false;
    }
  }

  function setupAuthListener() {
    firebase.auth().onAuthStateChanged(async (user) => {
      currentUser = user;
      updateAuthUI();
      if (user) {
        await loadFromFirestore();
      }
    });
  }

  async function googleLogin() {
    if (!isFirebaseConfigured) {
      showToast('Firebase設定が必要です。firebase-config.jsを編集してください。');
      return;
    }
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await firebase.auth().signInWithPopup(provider);
      showToast('ログインしました');
    } catch (e) {
      if (e.code !== 'auth/popup-closed-by-user') {
        showToast('ログインに失敗しました');
        console.error('Login error:', e);
      }
    }
  }

  async function googleLogout() {
    try {
      await firebase.auth().signOut();
      currentUser = null;
      updateAuthUI();
      showToast('ログアウトしました');
    } catch (e) {
      showToast('ログアウトに失敗しました');
    }
  }

  async function loadFromFirestore() {
    try {
      const doc = await firebase.firestore()
        .collection('users').doc(currentUser.uid).get();
      if (doc.exists) {
        state = doc.data();
        if (!state.videos) state.videos = [];
        saveStateLocal();
        renderAll();
      } else {
        await saveToFirestore();
      }
    } catch (e) {
      console.error('Firestore load error:', e);
    }
  }

  async function saveToFirestore() {
    if (!currentUser || !isFirebaseConfigured) return;
    try {
      await firebase.firestore()
        .collection('users').doc(currentUser.uid)
        .set(JSON.parse(JSON.stringify(state)));
    } catch (e) {
      console.error('Firestore save error:', e);
    }
  }

  function updateAuthUI() {
    if (currentUser) {
      googleLoginBtn.style.display = 'none';
      userInfo.style.display = '';
      userAvatar.src = currentUser.photoURL || '';
      userName.textContent = currentUser.displayName || 'User';
    } else {
      googleLoginBtn.style.display = '';
      userInfo.style.display = 'none';
    }
  }

  // ===== YouTube Helpers =====
  function extractVideoId(url) {
    if (!url) return null;
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
      /^([a-zA-Z0-9_-]{11})$/
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  function formatTime(seconds) {
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  // ===== YouTube IFrame API =====
  function loadYouTubeAPI() {
    return new Promise((resolve) => {
      if (window.YT && window.YT.Player) {
        resolve();
        return;
      }
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
      window.onYouTubeIframeAPIReady = resolve;
    });
  }

  async function loadVideo(videoId) {
    if (currentVideoId === videoId && player) return;

    currentVideoId = videoId;
    playerSection.style.display = '';
    bookmarksSection.style.display = '';

    // Reset loop
    clearLoop();

    await loadYouTubeAPI();

    if (player) {
      player.loadVideoById(videoId);
    } else {
      player = new YT.Player('youtubePlayer', {
        videoId: videoId,
        playerVars: {
          autoplay: 0,
          modestbranding: 1,
          rel: 0,
          cc_load_policy: 1,
        },
        events: {
          onReady: onPlayerReady,
          onStateChange: onPlayerStateChange,
        }
      });
    }

    // Save to library
    let videoEntry = state.videos.find(v => v.videoId === videoId);
    if (!videoEntry) {
      videoEntry = {
        videoId: videoId,
        title: '',
        bookmarks: [],
        addedAt: new Date().toISOString()
      };
      state.videos.unshift(videoEntry);
      saveState();
    }

    renderBookmarks();
    renderLibrary();
    updateLibraryActiveState();

    // Load subtitles
    loadSubtitles(videoId);
  }

  function onPlayerReady() {
    startTimeUpdate();
    const videoData = player.getVideoData();
    if (videoData && videoData.title) {
      const entry = state.videos.find(v => v.videoId === currentVideoId);
      if (entry && !entry.title) {
        entry.title = videoData.title;
        saveState();
        renderLibrary();
      }
    }
  }

  function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.PLAYING) {
      startTimeUpdate();
      const videoData = player.getVideoData();
      if (videoData && videoData.title) {
        const entry = state.videos.find(v => v.videoId === currentVideoId);
        if (entry && !entry.title) {
          entry.title = videoData.title;
          saveState();
          renderLibrary();
        }
      }
    }
  }

  function startTimeUpdate() {
    if (timeUpdateInterval) clearInterval(timeUpdateInterval);
    timeUpdateInterval = setInterval(() => {
      if (player && player.getCurrentTime) {
        const ct = player.getCurrentTime();
        currentTimeDisplay.textContent = formatTime(ct);
        checkLoop(ct);
        updateSubtitleHighlight(ct);
      }
    }, 100);
  }

  // ===== Loop =====
  function toggleLoop() {
    if (!player || !player.getDuration) return;

    if (loopState === 'idle') {
      loopA = player.getCurrentTime();
      loopState = 'a-set';
      updateLoopUI();
      showToast(`A点を設定: ${formatTime(loopA)}`);
    } else if (loopState === 'a-set') {
      loopB = player.getCurrentTime();
      if (loopB <= loopA) {
        showToast('B点はA点より後に設定してください');
        return;
      }
      loopState = 'looping';
      updateLoopUI();
      showToast(`ループ再生: ${formatTime(loopA)} → ${formatTime(loopB)}`);
    } else {
      clearLoop();
    }
  }

  function clearLoop() {
    loopState = 'idle';
    loopA = null;
    loopB = null;
    updateLoopUI();
  }

  function updateLoopUI() {
    loopBtn.classList.remove('btn-loop--a-set', 'btn-loop--looping');

    if (loopState === 'idle') {
      loopBtn.querySelector('span').textContent = 'ループ';
      loopIndicator.style.display = 'none';
    } else if (loopState === 'a-set') {
      loopBtn.classList.add('btn-loop--a-set');
      loopBtn.querySelector('span').textContent = `A: ${formatTime(loopA)}`;
      loopIndicator.style.display = 'none';
    } else {
      loopBtn.classList.add('btn-loop--looping');
      loopBtn.querySelector('span').textContent = 'ループ中';
      loopIndicator.style.display = '';
      loopRange.textContent = `${formatTime(loopA)} → ${formatTime(loopB)}`;
    }
  }

  function checkLoop(currentTime) {
    if (loopState === 'looping' && currentTime >= loopB) {
      player.seekTo(loopA, true);
    }
  }

  // ===== Speed Control =====
  function cycleSpeed() {
    currentSpeedIndex = (currentSpeedIndex + 1) % SPEED_OPTIONS.length;
    const speed = SPEED_OPTIONS[currentSpeedIndex];
    if (player && player.setPlaybackRate) {
      player.setPlaybackRate(speed);
    }
    updateSpeedUI();
  }

  function updateSpeedUI() {
    const speed = SPEED_OPTIONS[currentSpeedIndex];
    speedLabel.textContent = speed === 1 ? '1x' : speed + 'x';
    speedBtn.classList.toggle('btn-speed--active', speed !== 1);
  }

  // ===== Subtitles =====
  function decodeHtmlEntities(text) {
    const ta = document.createElement('textarea');
    ta.innerHTML = text;
    return ta.value;
  }

  async function fetchSubtitles(videoId) {
    if (subtitleCache[videoId]) return subtitleCache[videoId];

    console.log('[Subtitles] Fetching via proxy for', videoId);
    try {
      const resp = await fetch(`${SUBTITLE_PROXY_URL}?v=${videoId}`);
      if (!resp.ok) throw new Error(`Proxy returned ${resp.status}`);

      const data = await resp.json();
      if (data.error) throw new Error(data.error);

      if (data.subtitles && data.subtitles.length > 0) {
        subtitleCache[videoId] = data.subtitles;
        return data.subtitles;
      }
    } catch (e) {
      console.error('[Subtitles] Fetch failed:', e.message);
    }
    return null;
  }

  async function loadSubtitles(videoId) {
    subtitles = null;
    lastActiveSubIdx = -1;
    subtitlePanel.style.display = '';
    subtitlePanel.classList.remove('subtitle-panel--collapsed');
    subtitleLoading.style.display = '';
    subtitleList.style.display = 'none';
    subtitleEmpty.style.display = 'none';
    subtitleList.innerHTML = '';

    const subs = await fetchSubtitles(videoId);

    subtitleLoading.style.display = 'none';

    if (subs && subs.length > 0) {
      subtitles = subs;
      subtitleList.style.display = '';
      renderSubtitles();
    } else {
      subtitleEmpty.style.display = '';
    }
  }

  function isSubtitleBookmarked(subIndex) {
    if (!subtitles || !subtitles[subIndex]) return false;
    const entry = getCurrentVideoEntry();
    if (!entry) return false;
    const sub = subtitles[subIndex];
    return entry.bookmarks.some(b => Math.abs(b.time - Math.floor(sub.start)) < 1);
  }

  function getBookmarkForSubtitle(subIndex) {
    if (!subtitles || !subtitles[subIndex]) return null;
    const entry = getCurrentVideoEntry();
    if (!entry) return null;
    const sub = subtitles[subIndex];
    return entry.bookmarks.find(b => Math.abs(b.time - Math.floor(sub.start)) < 1);
  }

  function renderSubtitles() {
    const bookmarkIcon = `<svg class="subtitle-line__bookmark-icon" width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M10 3L12.09 7.26L16.82 7.94L13.41 11.27L14.18 15.97L10 13.77L5.82 15.97L6.59 11.27L3.18 7.94L7.91 7.26L10 3Z" stroke="currentColor" stroke-width="1.5" fill="currentColor" fill-opacity="0.15" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    subtitleList.innerHTML = subtitles.map((s, i) => {
      const isBookmarked = isSubtitleBookmarked(i);
      return `
        <div class="subtitle-line ${isBookmarked ? 'subtitle-line--bookmarked' : ''}" data-index="${i}" data-start="${s.start}" data-duration="${s.duration}">
          <span class="subtitle-line__time">${formatTime(s.start)}</span>
          <span class="subtitle-line__text">${escapeHtml(s.text)}</span>
          ${bookmarkIcon}
        </div>
      `;
    }).join('');
  }

  function toggleSubtitleBookmark(subIndex) {
    if (!subtitles || !subtitles[subIndex]) return;
    const sub = subtitles[subIndex];
    const entry = getCurrentVideoEntry();
    if (!entry) return;

    const existing = getBookmarkForSubtitle(subIndex);
    if (existing) {
      // Remove bookmark
      entry.bookmarks = entry.bookmarks.filter(b => b.id !== existing.id);
      saveState();
      renderBookmarks();
      renderSubtitles();
      renderLibrary();
      showToast('ブックマークを解除しました');
    } else {
      // Add bookmark with subtitle text as note
      entry.bookmarks.push({
        id: generateId(),
        time: sub.start,
        duration: sub.duration,
        note: sub.text,
        createdAt: new Date().toISOString()
      });
      entry.bookmarks.sort((a, b) => a.time - b.time);
      saveState();
      renderBookmarks();
      renderSubtitles();
      renderLibrary();
      showToast('ブックマークに追加しました');
    }
  }

  function updateSubtitleHighlight(currentTime) {
    if (!subtitles || subtitles.length === 0) return;

    let activeIndex = -1;
    for (let i = subtitles.length - 1; i >= 0; i--) {
      if (currentTime >= subtitles[i].start) {
        activeIndex = i;
        break;
      }
    }

    if (activeIndex === lastActiveSubIdx) return;
    lastActiveSubIdx = activeIndex;

    const lines = subtitleList.querySelectorAll('.subtitle-line');
    lines.forEach((line, i) => {
      const isActive = i === activeIndex;
      line.classList.toggle('subtitle-line--active', isActive);
      if (isActive && !subtitlePanel.classList.contains('subtitle-panel--collapsed')) {
        const body = subtitlePanel.querySelector('.subtitle-panel__body');
        if (body) {
          const lineTop = line.offsetTop;
          const lineBottom = lineTop + line.offsetHeight;
          const bodyTop = body.scrollTop;
          const bodyBottom = bodyTop + body.offsetHeight;

          if (lineTop < bodyTop) {
            body.scrollTo({ top: lineTop, behavior: 'smooth' });
          } else if (lineBottom > bodyBottom) {
            body.scrollTo({ top: lineBottom - body.offsetHeight, behavior: 'smooth' });
          }
        }
      }
    });
  }

  // ===== Bookmarks =====
  function getCurrentVideoEntry() {
    return state.videos.find(v => v.videoId === currentVideoId);
  }

  function deleteBookmark(bookmarkId) {
    const entry = getCurrentVideoEntry();
    if (!entry) return;
    entry.bookmarks = entry.bookmarks.filter(b => b.id !== bookmarkId);
    saveState();
    renderBookmarks();
    renderSubtitles();
    renderLibrary();
    // Clear loop if the deleted bookmark was being looped
    if (loopState === 'looping') {
      clearLoop();
    }
    showToast('ブックマークを削除しました');
  }

  function updateBookmark(bookmarkId, note) {
    const entry = getCurrentVideoEntry();
    if (!entry) return;
    const bookmark = entry.bookmarks.find(b => b.id === bookmarkId);
    if (bookmark) {
      bookmark.note = note;
      saveState();
      renderBookmarks();
      showToast('ブックマークを更新しました');
    }
  }

  function seekTo(time) {
    if (player && player.seekTo) {
      player.seekTo(time, true);
      player.playVideo();
    }
  }

  function startBookmarkLoop(bookmark) {
    const startTime = bookmark.time;
    const duration = bookmark.duration || 3;
    const endTime = startTime + duration;

    loopA = startTime;
    loopB = endTime;
    loopState = 'looping';
    updateLoopUI();

    // Highlight active bookmark card
    document.querySelectorAll('.bookmark-card').forEach(card => {
      card.classList.toggle('bookmark-card--loop-active', card.dataset.id === bookmark.id);
    });

    seekTo(startTime);
    showToast(`ループ再生: ${formatTime(startTime)} → ${formatTime(endTime)}`);
  }

  // ===== Rendering =====
  function renderAll() {
    renderBookmarks();
    renderLibrary();
    if (currentVideoId) updateLibraryActiveState();
  }

  function renderBookmarks() {
    const entry = getCurrentVideoEntry();
    const bookmarks = entry ? entry.bookmarks : [];
    const count = bookmarks.length;
    bookmarkCount.textContent = count;

    if (count === 0) {
      bookmarksList.innerHTML = '';
      bookmarksEmpty.style.display = '';
      return;
    }

    bookmarksEmpty.style.display = 'none';
    bookmarksList.innerHTML = bookmarks.map((b, i) => `
      <div class="bookmark-card" data-id="${b.id}" data-time="${b.time}" data-duration="${b.duration || 3}" style="animation-delay: ${i * 50}ms">
        <div class="bookmark-card__time">
          <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
            <path d="M2.5 9A6.5 6.5 0 0115.36 5.5M15.5 9A6.5 6.5 0 012.64 12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          ${formatTime(b.time)}
        </div>
        <div class="bookmark-card__content">
          <div class="bookmark-card__note">${escapeHtml(b.note)}</div>
        </div>
        <div class="bookmark-card__actions">
          <button class="bookmark-card__action bookmark-card__action--edit" data-action="edit" data-id="${b.id}" title="編集">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M8.5 2.5L11.5 5.5M1.5 12.5L2.25 9.75L10 2L12 4L4.25 11.75L1.5 12.5Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="bookmark-card__action bookmark-card__action--delete" data-action="delete" data-id="${b.id}" title="削除">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2.5 4H11.5M5 4V2.5H9V4M5.5 6.5V10.5M8.5 6.5V10.5M3.5 4L4 11.5H10L10.5 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    `).join('');
  }

  function renderLibrary() {
    if (state.videos.length === 0) {
      libraryList.innerHTML = '';
      libraryEmpty.style.display = '';
      return;
    }

    libraryEmpty.style.display = 'none';
    libraryList.innerHTML = state.videos.map(v => `
      <div class="library-card ${v.videoId === currentVideoId ? 'library-card--active' : ''}" data-video-id="${v.videoId}">
        <img class="library-card__thumb" src="https://img.youtube.com/vi/${v.videoId}/mqdefault.jpg" alt="" loading="lazy">
        <div class="library-card__info">
          <div class="library-card__title">${escapeHtml(v.title || v.videoId)}</div>
          <div class="library-card__meta">${v.bookmarks.length}個のブックマーク</div>
        </div>
        ${v.bookmarks.length > 0 ? `<span class="library-card__badge">${v.bookmarks.length}</span>` : ''}
        <button class="library-card__delete" data-delete-video="${v.videoId}" title="ライブラリから削除">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2.5 4H11.5M5 4V2.5H9V4M5.5 6.5V10.5M8.5 6.5V10.5M3.5 4L4 11.5H10L10.5 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    `).join('');
  }

  function updateLibraryActiveState() {
    document.querySelectorAll('.library-card').forEach(card => {
      card.classList.toggle('library-card--active', card.dataset.videoId === currentVideoId);
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ===== Toast =====
  let toastTimeout = null;
  function showToast(message) {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.remove('visible');
    void toast.offsetWidth;
    toast.classList.add('visible');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove('visible'), 2000);
  }

  // ===== Modal Helpers =====
  function openBookmarkModal(time, prefillNote) {
    if (!player || !player.getCurrentTime) return;
    const t = time !== undefined ? time : player.getCurrentTime();
    modalTime.textContent = formatTime(t);
    bookmarkNote.value = prefillNote || '';
    bookmarkModal.classList.add('active');
    bookmarkModal.dataset.time = Math.floor(t);
    setTimeout(() => bookmarkNote.focus(), 300);
  }

  function closeBookmarkModal() {
    bookmarkModal.classList.remove('active');
  }

  function openEditModal(bookmarkId) {
    const entry = getCurrentVideoEntry();
    if (!entry) return;
    const bookmark = entry.bookmarks.find(b => b.id === bookmarkId);
    if (!bookmark) return;
    editingBookmarkId = bookmarkId;
    editModalTime.textContent = formatTime(bookmark.time);
    editBookmarkNote.value = bookmark.note;
    editModal.classList.add('active');
    setTimeout(() => editBookmarkNote.focus(), 300);
  }

  function closeEditModal() {
    editModal.classList.remove('active');
    editingBookmarkId = null;
  }

  // ===== Event Listeners =====

  // Video loading
  loadVideoBtn.addEventListener('click', () => {
    const url = videoUrlInput.value.trim();
    const videoId = extractVideoId(url);
    if (videoId) {
      loadVideo(videoId);
      videoUrlInput.value = '';
    } else {
      showToast('有効なYouTube URLを入力してください');
    }
  });

  videoUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadVideoBtn.click();
  });

  videoUrlInput.addEventListener('paste', () => {
    setTimeout(() => {
      const url = videoUrlInput.value.trim();
      const videoId = extractVideoId(url);
      if (videoId) {
        loadVideo(videoId);
        videoUrlInput.value = '';
      }
    }, 100);
  });

  // Bookmark modal
  modalClose.addEventListener('click', closeBookmarkModal);
  modalCancel.addEventListener('click', closeBookmarkModal);
  modalSave.addEventListener('click', () => {
    const time = parseInt(bookmarkModal.dataset.time, 10);
    const entry = getCurrentVideoEntry();
    if (entry) {
      entry.bookmarks.push({
        id: generateId(),
        time: time,
        note: bookmarkNote.value.trim(),
        createdAt: new Date().toISOString()
      });
      entry.bookmarks.sort((a, b) => a.time - b.time);
      saveState();
      renderBookmarks();
      renderSubtitles();
      renderLibrary();
      showToast('ブックマークを追加しました');
    }
    closeBookmarkModal();
  });
  bookmarkModal.addEventListener('click', (e) => {
    if (e.target === bookmarkModal) closeBookmarkModal();
  });

  // Edit modal
  editModalClose.addEventListener('click', closeEditModal);
  editModalCancel.addEventListener('click', closeEditModal);
  editModalSave.addEventListener('click', () => {
    if (editingBookmarkId) {
      updateBookmark(editingBookmarkId, editBookmarkNote.value.trim());
      closeEditModal();
    }
  });
  editModal.addEventListener('click', (e) => {
    if (e.target === editModal) closeEditModal();
  });

  // Bookmark list delegation — clicking a bookmark starts a loop
  bookmarksList.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      e.stopPropagation();
      const action = actionBtn.dataset.action;
      const id = actionBtn.dataset.id;
      if (action === 'delete') deleteBookmark(id);
      else if (action === 'edit') openEditModal(id);
      return;
    }
    const card = e.target.closest('.bookmark-card');
    if (card) {
      const entry = getCurrentVideoEntry();
      if (entry) {
        const bookmark = entry.bookmarks.find(b => b.id === card.dataset.id);
        if (bookmark) {
          startBookmarkLoop(bookmark);
        }
      }
    }
  });

  // Library delegation
  libraryList.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('[data-delete-video]');
    if (deleteBtn) {
      e.stopPropagation();
      const videoId = deleteBtn.dataset.deleteVideo;
      state.videos = state.videos.filter(v => v.videoId !== videoId);
      saveState();
      if (videoId === currentVideoId) {
        currentVideoId = null;
        playerSection.style.display = 'none';
        bookmarksSection.style.display = 'none';
        subtitlePanel.style.display = 'none';
        if (player) {
          player.destroy();
          player = null;
          const container = document.getElementById('playerContainer');
          container.innerHTML = '<div id="youtubePlayer"></div>';
        }
      }
      renderLibrary();
      showToast('動画をライブラリから削除しました');
      return;
    }
    const card = e.target.closest('.library-card');
    if (card) loadVideo(card.dataset.videoId);
  });

  // Loop
  loopBtn.addEventListener('click', toggleLoop);
  loopClear.addEventListener('click', (e) => {
    e.stopPropagation();
    clearLoop();
    showToast('ループを解除しました');
  });

  // Subtitle toggle
  subtitleToggle.addEventListener('click', () => {
    subtitlePanel.classList.toggle('subtitle-panel--collapsed');
  });

  // Subtitle line click — toggle bookmark
  subtitleList.addEventListener('click', (e) => {
    const line = e.target.closest('.subtitle-line');
    if (line) {
      const index = parseInt(line.dataset.index, 10);
      toggleSubtitleBookmark(index);
    }
  });

  // Speed control
  speedBtn.addEventListener('click', cycleSpeed);

  // Auth
  googleLoginBtn.addEventListener('click', googleLogin);
  logoutBtn.addEventListener('click', googleLogout);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeBookmarkModal();
      closeEditModal();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'l' && currentVideoId) {
      e.preventDefault();
      toggleLoop();
    }
  });

  // ===== Init =====
  function init() {
    renderLibrary();
    checkFirebase();
    if (state.videos.length > 0) {
      const lastVideo = state.videos[0];
      loadVideo(lastVideo.videoId);
    }
  }

  init();
})();
