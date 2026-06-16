const USERS_KEY = 'todolist_users';
const SESSION_KEY = 'todolist_session';
const LEGACY_TODOS_KEY = 'todolist_items';
const TODOS_KEY_PREFIX = 'todolist_items_';

const PRIORITY_LABELS = { high: '高', medium: '中', low: '低' };
const USERNAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5]{3,20}$/;
const MAX_IMAGES = 3;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const REMINDER_CHECK_INTERVAL = 15000;

/** @type {string|null} */
let currentUser = null;

/** @type {{ id: string, text: string, completed: boolean, priority: string, dueDate: string|null, assignee: string, images: string[], remindAt: number|null, createdAt: number, updatedAt: number, completedAt: number|null }[]} */
let todos = [];
let currentFilter = 'all';
let personFilter = '';
let editingId = null;
let deletingId = null;
/** @type {string[]} */
let addImages = [];
/** @type {string[]} */
let editImages = [];
let reminderCheckTimer = null;
/** @type {string[]} */
let reminderQueue = [];
let activeReminderId = null;

// Auth DOM
const authView = document.getElementById('authView');
const appView = document.getElementById('appView');
const authTabs = document.querySelectorAll('.auth-tab');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginUsername = document.getElementById('loginUsername');
const loginPassword = document.getElementById('loginPassword');
const registerUsername = document.getElementById('registerUsername');
const registerPassword = document.getElementById('registerPassword');
const registerConfirm = document.getElementById('registerConfirm');
const loginError = document.getElementById('loginError');
const registerError = document.getElementById('registerError');
const logoutBtn = document.getElementById('logoutBtn');
const userName = document.getElementById('userName');
const userAvatar = document.getElementById('userAvatar');

// Todo DOM
const todoForm = document.getElementById('todoForm');
const todoInput = document.getElementById('todoInput');
const addPriority = document.getElementById('addPriority');
const addDueDate = document.getElementById('addDueDate');
const addAssignee = document.getElementById('addAssignee');
const addRemindAt = document.getElementById('addRemindAt');
const personSearch = document.getElementById('personSearch');
const clearPersonSearch = document.getElementById('clearPersonSearch');
const assigneeList = document.getElementById('assigneeList');
const todoList = document.getElementById('todoList');
const emptyState = document.getElementById('emptyState');
const activeCount = document.getElementById('activeCount');
const cardFooter = document.getElementById('cardFooter');
const clearCompletedBtn = document.getElementById('clearCompleted');
const filterBtns = document.querySelectorAll('.filter-btn');
const editDialog = document.getElementById('editDialog');
const editForm = document.getElementById('editForm');
const editInput = document.getElementById('editInput');
const editPriority = document.getElementById('editPriority');
const editDueDate = document.getElementById('editDueDate');
const editAssignee = document.getElementById('editAssignee');
const editRemindAt = document.getElementById('editRemindAt');
const editCancel = document.getElementById('editCancel');
const addImagesInput = document.getElementById('addImages');
const addImageBtn = document.getElementById('addImageBtn');
const addImagePreview = document.getElementById('addImagePreview');
const addImageCount = document.getElementById('addImageCount');
const editImagesInput = document.getElementById('editImages');
const editImageBtn = document.getElementById('editImageBtn');
const editImagePreview = document.getElementById('editImagePreview');
const editImageCount = document.getElementById('editImageCount');
const imageViewer = document.getElementById('imageViewer');
const viewerImage = document.getElementById('viewerImage');
const viewerClose = document.getElementById('viewerClose');
const reminderDialog = document.getElementById('reminderDialog');
const reminderText = document.getElementById('reminderText');
const reminderMeta = document.getElementById('reminderMeta');
const confirmDialog = document.getElementById('confirmDialog');
const confirmText = document.getElementById('confirmText');
const confirmCancel = document.getElementById('confirmCancel');
const confirmDelete = document.getElementById('confirmDelete');

// ===== Auth =====
function getTodosKey(username) {
  return `${TODOS_KEY_PREFIX}${username}`;
}

async function hashPassword(username, password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${username}:${password}:todolist_v1`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

function getUsers() {
  try {
    const data = localStorage.getItem(USERS_KEY);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function getSession() {
  return localStorage.getItem(SESSION_KEY);
}

function setSession(username) {
  localStorage.setItem(SESSION_KEY, username);
  currentUser = username;
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  currentUser = null;
}

function validateUsername(username) {
  if (!USERNAME_RE.test(username)) {
    return '用户名为 3-20 位，支持字母、数字、下划线和中文';
  }
  return '';
}

function validatePassword(password) {
  if (password.length < 6) return '密码至少 6 位';
  if (password.length > 32) return '密码最多 32 位';
  return '';
}

function showAuthError(el, message) {
  if (message) {
    el.textContent = message;
    el.hidden = false;
  } else {
    el.textContent = '';
    el.hidden = true;
  }
}

function switchAuthTab(tab) {
  authTabs.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.authTab === tab);
  });
  loginForm.hidden = tab !== 'login';
  registerForm.hidden = tab !== 'register';
  showAuthError(loginError, '');
  showAuthError(registerError, '');
}

function showAuthView() {
  authView.hidden = false;
  appView.hidden = true;
  todos = [];
  stopReminderChecker();
  reminderQueue = [];
  activeReminderId = null;
  reminderDialog.close();
  switchAuthTab('login');
  loginUsername.focus();
}

function showAppView() {
  authView.hidden = true;
  appView.hidden = false;
  loginForm.reset();
  registerForm.reset();
  showAuthError(loginError, '');
  showAuthError(registerError, '');
  userName.textContent = currentUser;
  userAvatar.textContent = currentUser.charAt(0).toUpperCase();
  loadTodos();
  resetFilters();
  render();
  requestNotificationPermission();
  startReminderChecker();
  checkReminders();
  todoInput.focus();
}

function resetFilters() {
  currentFilter = 'all';
  personFilter = '';
  personSearch.value = '';
  clearPersonSearch.hidden = true;
  filterBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === 'all');
  });
}

function migrateLegacyTodos(username) {
  const legacy = localStorage.getItem(LEGACY_TODOS_KEY);
  const userKey = getTodosKey(username);
  if (legacy && !localStorage.getItem(userKey)) {
    localStorage.setItem(userKey, legacy);
    localStorage.removeItem(LEGACY_TODOS_KEY);
  }
}

async function registerUser(username, password) {
  const nameErr = validateUsername(username);
  if (nameErr) return { ok: false, message: nameErr };

  const pwdErr = validatePassword(password);
  if (pwdErr) return { ok: false, message: pwdErr };

  const users = getUsers();
  if (users[username]) {
    return { ok: false, message: '该用户名已被注册' };
  }

  users[username] = {
    passwordHash: await hashPassword(username, password),
    createdAt: Date.now(),
  };
  saveUsers(users);
  migrateLegacyTodos(username);
  setSession(username);
  return { ok: true };
}

async function loginUser(username, password) {
  const nameErr = validateUsername(username);
  if (nameErr) return { ok: false, message: nameErr };

  const pwdErr = validatePassword(password);
  if (pwdErr) return { ok: false, message: pwdErr };

  const users = getUsers();
  const user = users[username];
  if (!user) {
    return { ok: false, message: '用户名或密码错误' };
  }

  const hash = await hashPassword(username, password);
  if (hash !== user.passwordHash) {
    return { ok: false, message: '用户名或密码错误' };
  }

  migrateLegacyTodos(username);
  setSession(username);
  return { ok: true };
}

function logout() {
  clearSession();
  todos = [];
  editingId = null;
  deletingId = null;
  editDialog.close();
  confirmDialog.close();
  loginForm.reset();
  registerForm.reset();
  showAuthView();
}

function restoreSession() {
  const username = getSession();
  if (!username) return false;

  const users = getUsers();
  if (!users[username]) {
    clearSession();
    return false;
  }

  currentUser = username;
  return true;
}

// ===== Storage =====
function migrateTodo(todo) {
  const completed = !!todo.completed;
  return {
    id: todo.id,
    text: todo.text,
    completed,
    priority: todo.priority || 'medium',
    dueDate: todo.dueDate || null,
    assignee: todo.assignee || '',
    images: Array.isArray(todo.images) ? todo.images.slice(0, MAX_IMAGES) : [],
    remindAt: todo.remindAt || null,
    createdAt: todo.createdAt || Date.now(),
    updatedAt: todo.updatedAt || Date.now(),
    completedAt: completed ? (todo.completedAt || todo.updatedAt || Date.now()) : null,
  };
}

function loadTodos() {
  if (!currentUser) {
    todos = [];
    return;
  }

  try {
    const data = localStorage.getItem(getTodosKey(currentUser));
    todos = data ? JSON.parse(data).map(migrateTodo) : [];
  } catch {
    todos = [];
  }
}

function saveTodos() {
  if (!currentUser) return;
  try {
    localStorage.setItem(getTodosKey(currentUser), JSON.stringify(todos));
  } catch {
    alert('存储空间不足，请减少图片数量或大小后重试');
  }
}

function getAllAssignees() {
  const names = new Set();
  todos.forEach(t => {
    const name = t.assignee.trim();
    if (name) names.add(name);
  });
  return [...names].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function updateAssigneeDatalist() {
  assigneeList.innerHTML = getAllAssignees()
    .map(name => `<option value="${escapeHtml(name)}">`)
    .join('');
}

// ===== CRUD =====
function createTodo(data) {
  const trimmed = data.text.trim();
  if (!trimmed) return false;

  todos.unshift({
    id: crypto.randomUUID(),
    text: trimmed,
    completed: false,
    priority: data.priority || 'medium',
    dueDate: data.dueDate || null,
    assignee: (data.assignee || '').trim(),
    images: (data.images || []).slice(0, MAX_IMAGES),
    remindAt: data.remindAt || null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedAt: null,
  });

  saveTodos();
  render();
  return true;
}

function readTodos() {
  let result = todos;

  switch (currentFilter) {
    case 'active':
      result = result.filter(t => !t.completed);
      break;
    case 'completed':
      result = result.filter(t => t.completed);
      break;
  }

  if (personFilter.trim()) {
    const keyword = personFilter.trim().toLowerCase();
    result = result.filter(t => t.assignee.toLowerCase().includes(keyword));
  }

  return sortTodos(result);
}

function sortTodos(list) {
  return [...list].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;

    if (!a.completed) {
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return b.createdAt - a.createdAt;
    }

    const aCompleted = a.completedAt || a.updatedAt || 0;
    const bCompleted = b.completedAt || b.updatedAt || 0;
    return bCompleted - aCompleted;
  });
}

function updateTodo(id, updates) {
  const index = todos.findIndex(t => t.id === id);
  if (index === -1) return false;

  todos[index] = {
    ...todos[index],
    ...updates,
    updatedAt: Date.now(),
  };

  saveTodos();
  render();
  return true;
}

function deleteTodo(id) {
  todos = todos.filter(t => t.id !== id);
  saveTodos();
  render();
}

function toggleTodo(id) {
  const todo = todos.find(t => t.id === id);
  if (!todo) return;
  const completed = !todo.completed;
  updateTodo(id, {
    completed,
    completedAt: completed ? Date.now() : null,
  });
}

function clearCompleted() {
  todos = todos.filter(t => !t.completed);
  saveTodos();
  render();
}

// ===== Helpers =====
function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  if (isToday) return `今天 ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;

  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' ' + time;
}

function formatDueDate(dateStr) {
  if (!dateStr) return null;
  const due = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const diff = Math.round((due - now) / 86400000);
  const label = due.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });

  if (diff < 0) return { text: `已逾期 ${Math.abs(diff)} 天`, className: 'due-overdue' };
  if (diff === 0) return { text: `今天截止`, className: 'due-today' };
  if (diff === 1) return { text: `明天截止`, className: 'due-soon' };
  if (diff <= 3) return { text: `${label} 截止`, className: 'due-soon' };
  return { text: `${label} 截止`, className: '' };
}

function formatCompletedAt(timestamp) {
  return `完成于 ${formatTime(timestamp)}`;
}

function parseDateTimeLocal(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function toDateTimeLocal(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatRemindAt(timestamp) {
  const date = new Date(timestamp);
  const now = Date.now();
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  if (timestamp <= now) {
    return { text: '待提醒', className: 'remind-due' };
  }

  const isToday = date.toDateString() === new Date().toDateString();
  if (isToday) return { text: `今天 ${time} 提醒`, className: 'remind-soon' };

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString()) {
    return { text: `明天 ${time} 提醒`, className: 'remind-soon' };
  }

  const label = date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  return { text: `${label} ${time} 提醒`, className: '' };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ===== Images =====
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const maxWidth = 800;
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

async function processImageFiles(files, imagesArray) {
  const remaining = MAX_IMAGES - imagesArray.length;
  if (remaining <= 0) {
    alert(`最多只能添加 ${MAX_IMAGES} 张图片`);
    return;
  }

  const toAdd = Array.from(files).slice(0, remaining);
  if (Array.from(files).length > remaining) {
    alert(`最多只能添加 ${MAX_IMAGES} 张图片，已忽略超出部分`);
  }

  for (const file of toAdd) {
    if (!file.type.startsWith('image/')) {
      alert(`「${file.name}」不是有效的图片文件`);
      continue;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      alert(`「${file.name}」超过 5MB 大小限制`);
      continue;
    }
    try {
      imagesArray.push(await compressImage(file));
    } catch {
      alert(`「${file.name}」处理失败，请换一张试试`);
    }
  }
}

function renderImagePreviews(container, images, onRemove) {
  container.innerHTML = images.map((src, index) => `
    <div class="image-preview-item">
      <img src="${src}" alt="预览图 ${index + 1}">
      <button type="button" class="image-remove" data-index="${index}" aria-label="移除图片">×</button>
    </div>
  `).join('');

  container.querySelectorAll('.image-remove').forEach(btn => {
    btn.addEventListener('click', () => onRemove(Number(btn.dataset.index)));
  });

  container.querySelectorAll('img').forEach(img => {
    img.addEventListener('click', () => openImageViewer(img.src));
  });
}

function updateImageUploadUI(images, previewEl, countEl, btnEl) {
  renderImagePreviews(previewEl, images, index => {
    images.splice(index, 1);
    updateImageUploadUI(images, previewEl, countEl, btnEl);
  });
  countEl.textContent = `${images.length}/${MAX_IMAGES}`;
  btnEl.disabled = images.length >= MAX_IMAGES;
}

function openImageViewer(src) {
  viewerImage.src = src;
  imageViewer.showModal();
}

function closeImageViewer() {
  imageViewer.close();
  viewerImage.src = '';
}

function resetAddForm() {
  todoInput.value = '';
  addPriority.value = 'medium';
  addDueDate.value = '';
  addAssignee.value = '';
  addRemindAt.value = '';
  addImages = [];
  addImagesInput.value = '';
  updateImageUploadUI(addImages, addImagePreview, addImageCount, addImageBtn);
}

// ===== Reminders =====
async function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}

function sendBrowserNotification(todo) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const notification = new Notification('待办提醒', {
    body: todo.text,
    tag: `todo-remind-${todo.id}`,
    requireInteraction: true,
  });

  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}

function startReminderChecker() {
  stopReminderChecker();
  reminderCheckTimer = window.setInterval(checkReminders, REMINDER_CHECK_INTERVAL);
}

function stopReminderChecker() {
  if (reminderCheckTimer) {
    clearInterval(reminderCheckTimer);
    reminderCheckTimer = null;
  }
}

function checkReminders() {
  if (!currentUser) return;

  const now = Date.now();
  todos
    .filter(t => !t.completed && t.remindAt && t.remindAt <= now)
    .forEach(todo => enqueueReminder(todo));
}

function enqueueReminder(todo) {
  if (activeReminderId === todo.id || reminderQueue.includes(todo.id)) return;
  reminderQueue.push(todo.id);
  processReminderQueue();
}

function processReminderQueue() {
  if (activeReminderId || reminderQueue.length === 0) return;

  const todoId = reminderQueue.shift();
  const todo = todos.find(t => t.id === todoId);
  if (!todo || todo.completed || !todo.remindAt || todo.remindAt > Date.now()) {
    processReminderQueue();
    return;
  }

  showReminderDialog(todo);
}

function showReminderDialog(todo) {
  activeReminderId = todo.id;
  reminderText.textContent = todo.text;

  const parts = [];
  if (todo.assignee) parts.push(`关系人：${todo.assignee}`);
  if (todo.dueDate) parts.push(`截止：${todo.dueDate}`);
  reminderMeta.textContent = parts.join(' · ') || '请及时处理此待办';

  sendBrowserNotification(todo);
  reminderDialog.showModal();
}

function handleReminderAction(action, minutes) {
  const todo = todos.find(t => t.id === activeReminderId);
  if (!todo) {
    closeReminderDialog();
    return;
  }

  if (action === 'dismiss') {
    updateTodo(todo.id, { remindAt: null });
  } else if (action === 'snooze') {
    updateTodo(todo.id, { remindAt: Date.now() + minutes * 60 * 1000 });
  }

  closeReminderDialog();
}

function closeReminderDialog() {
  activeReminderId = null;
  reminderDialog.close();
  processReminderQueue();
}

function resetEditImages() {
  editImages = [];
  editImagesInput.value = '';
  updateImageUploadUI(editImages, editImagePreview, editImageCount, editImageBtn);
}

// ===== Render =====
function renderTodoItem(todo) {
  const li = document.createElement('li');
  li.className = `todo-item${todo.completed ? ' completed' : ''}`;
  li.dataset.id = todo.id;

  const dueInfo = !todo.completed && todo.dueDate ? formatDueDate(todo.dueDate) : null;
  const dueHtml = dueInfo
    ? `<span class="todo-tag todo-due ${dueInfo.className}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        ${dueInfo.text}
      </span>`
    : '';

  const timeHtml = `<span class="todo-time">${formatTime(todo.createdAt)}</span>`;

  const completedHtml = todo.completed
    ? `<span class="todo-tag todo-completed-tag">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        ${formatCompletedAt(todo.completedAt || todo.updatedAt)}
      </span>`
    : '';

  const assigneeHtml = todo.assignee
    ? `<span class="todo-tag todo-assignee">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        ${escapeHtml(todo.assignee)}
      </span>`
    : '';

  const remindInfo = !todo.completed && todo.remindAt ? formatRemindAt(todo.remindAt) : null;
  const remindHtml = remindInfo
    ? `<span class="todo-tag todo-remind ${remindInfo.className}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
        ${remindInfo.text}
      </span>`
    : '';

  const imagesHtml = todo.images?.length
    ? `<div class="todo-images">${todo.images.map((src, i) =>
        `<button type="button" class="todo-thumb" data-index="${i}" aria-label="查看图片 ${i + 1}">
          <img src="${src}" alt="附件 ${i + 1}">
        </button>`
      ).join('')}</div>`
    : '';

  li.innerHTML = `
    <label class="checkbox" title="标记完成">
      <input type="checkbox" ${todo.completed ? 'checked' : ''} aria-label="标记完成">
      <span class="checkbox-mark">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </span>
    </label>
    <div class="todo-body">
      <div class="todo-main">
        <span class="priority-badge priority-${todo.priority}">${PRIORITY_LABELS[todo.priority] || '中'}</span>
        <span class="todo-text" title="双击编辑">${escapeHtml(todo.text)}</span>
      </div>
      <div class="todo-meta">
        ${dueHtml}
        ${remindHtml}
        ${completedHtml}
        ${assigneeHtml}
        ${timeHtml}
      </div>
      ${imagesHtml}
    </div>
    <div class="todo-actions">
      <button class="btn-icon edit" aria-label="编辑" title="编辑">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
      <button class="btn-icon delete" aria-label="删除" title="删除">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
        </svg>
      </button>
    </div>
  `;

  li.querySelector('input[type="checkbox"]').addEventListener('change', () => toggleTodo(todo.id));
  li.querySelector('.todo-text').addEventListener('dblclick', () => openEditDialog(todo.id));
  li.querySelector('.btn-icon.edit').addEventListener('click', () => openEditDialog(todo.id));
  li.querySelector('.btn-icon.delete').addEventListener('click', () => openConfirmDialog(todo.id));

  if (todo.assignee) {
    li.querySelector('.todo-assignee')?.addEventListener('click', () => {
      personSearch.value = todo.assignee;
      personFilter = todo.assignee;
      clearPersonSearch.hidden = false;
      render();
    });
  }

  li.querySelectorAll('.todo-thumb').forEach(btn => {
    const index = Number(btn.dataset.index);
    btn.addEventListener('click', () => openImageViewer(todo.images[index]));
  });

  return li;
}

function render() {
  const filtered = readTodos();
  todoList.innerHTML = '';

  filtered.forEach(todo => {
    todoList.appendChild(renderTodoItem(todo));
  });

  updateAssigneeDatalist();

  const hasItems = todos.length > 0;
  const hasFiltered = filtered.length > 0;
  const activeItems = todos.filter(t => !t.completed).length;
  const completedItems = todos.filter(t => t.completed).length;

  emptyState.classList.toggle('hidden', hasFiltered);
  activeCount.textContent = activeItems;
  cardFooter.hidden = completedItems === 0;
  clearPersonSearch.hidden = !personFilter.trim();

  if (!hasFiltered && hasItems) {
    const messages = {
      active: { title: '没有进行中的任务', desc: '所有任务都已完成，干得漂亮！' },
      completed: { title: '还没有完成的任务', desc: '完成一些任务后再来看看吧' },
    };
    let msg = messages[currentFilter] || { title: '没有匹配的任务', desc: '试试调整筛选条件' };

    if (personFilter.trim() && currentFilter === 'all') {
      msg = { title: '未找到相关任务', desc: `没有与「${personFilter.trim()}」相关的事项` };
    } else if (personFilter.trim()) {
      msg = { title: '未找到相关任务', desc: `当前筛选下没有与「${personFilter.trim()}」相关的事项` };
    }

    emptyState.querySelector('.empty-title').textContent = msg.title;
    emptyState.querySelector('.empty-desc').textContent = msg.desc;
  } else if (!hasItems) {
    emptyState.querySelector('.empty-title').textContent = '还没有任务';
    emptyState.querySelector('.empty-desc').textContent = '在上方输入框添加你的第一个待办吧';
  }
}

// ===== Edit Dialog =====
function openEditDialog(id) {
  const todo = todos.find(t => t.id === id);
  if (!todo) return;

  editingId = id;
  editInput.value = todo.text;
  editPriority.value = todo.priority || 'medium';
  editDueDate.value = todo.dueDate || '';
  editAssignee.value = todo.assignee || '';
  editRemindAt.value = toDateTimeLocal(todo.remindAt);
  editImages = [...(todo.images || [])];
  updateImageUploadUI(editImages, editImagePreview, editImageCount, editImageBtn);
  editDialog.showModal();
  editInput.focus();
  editInput.setSelectionRange(editInput.value.length, editInput.value.length);
}

function closeEditDialog() {
  editingId = null;
  resetEditImages();
  editDialog.close();
}

// ===== Confirm Dialog =====
function openConfirmDialog(id) {
  const todo = todos.find(t => t.id === id);
  if (!todo) return;

  deletingId = id;
  const preview = todo.text.length > 40 ? todo.text.slice(0, 40) + '…' : todo.text;
  confirmText.textContent = `确定要删除「${preview}」吗？此操作无法撤销。`;
  confirmDialog.showModal();
}

function closeConfirmDialog() {
  deletingId = null;
  confirmDialog.close();
}

// ===== Event Listeners =====
authTabs.forEach(tab => {
  tab.addEventListener('click', () => switchAuthTab(tab.dataset.authTab));
});

loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  showAuthError(loginError, '');
  const result = await loginUser(loginUsername.value.trim(), loginPassword.value);
  if (result.ok) {
    showAppView();
  } else {
    showAuthError(loginError, result.message);
  }
});

registerForm.addEventListener('submit', async e => {
  e.preventDefault();
  showAuthError(registerError, '');

  if (registerPassword.value !== registerConfirm.value) {
    showAuthError(registerError, '两次输入的密码不一致');
    return;
  }

  const result = await registerUser(registerUsername.value.trim(), registerPassword.value);
  if (result.ok) {
    showAppView();
  } else {
    showAuthError(registerError, result.message);
  }
});

logoutBtn.addEventListener('click', logout);

todoForm.addEventListener('submit', e => {
  e.preventDefault();
  if (createTodo({
    text: todoInput.value,
    priority: addPriority.value,
    dueDate: addDueDate.value || null,
    assignee: addAssignee.value,
    images: addImages,
    remindAt: parseDateTimeLocal(addRemindAt.value),
  })) {
    resetAddForm();
    todoInput.focus();
  }
});

addImageBtn.addEventListener('click', () => addImagesInput.click());

addImagesInput.addEventListener('change', async () => {
  await processImageFiles(addImagesInput.files, addImages);
  addImagesInput.value = '';
  updateImageUploadUI(addImages, addImagePreview, addImageCount, addImageBtn);
});

editImageBtn.addEventListener('click', () => editImagesInput.click());

editImagesInput.addEventListener('change', async () => {
  await processImageFiles(editImagesInput.files, editImages);
  editImagesInput.value = '';
  updateImageUploadUI(editImages, editImagePreview, editImageCount, editImageBtn);
});

viewerClose.addEventListener('click', closeImageViewer);
imageViewer.addEventListener('click', e => {
  if (e.target === imageViewer) closeImageViewer();
});

reminderDialog.querySelectorAll('[data-action]').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    const minutes = Number(btn.dataset.minutes) || 0;
    handleReminderAction(action, minutes);
  });
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentUser) {
    checkReminders();
  }
});

personSearch.addEventListener('input', () => {
  personFilter = personSearch.value;
  clearPersonSearch.hidden = !personFilter.trim();
  render();
});

clearPersonSearch.addEventListener('click', () => {
  personSearch.value = '';
  personFilter = '';
  clearPersonSearch.hidden = true;
  render();
  personSearch.focus();
});

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    render();
  });
});

clearCompletedBtn.addEventListener('click', clearCompleted);

editForm.addEventListener('submit', e => {
  e.preventDefault();
  const text = editInput.value.trim();
  if (!text || !editingId) {
    closeEditDialog();
    return;
  }
  updateTodo(editingId, {
    text,
    priority: editPriority.value,
    dueDate: editDueDate.value || null,
    assignee: editAssignee.value.trim(),
    images: editImages.slice(0, MAX_IMAGES),
    remindAt: parseDateTimeLocal(editRemindAt.value),
  });
  closeEditDialog();
});

editCancel.addEventListener('click', closeEditDialog);
editDialog.addEventListener('click', e => { if (e.target === editDialog) closeEditDialog(); });
confirmCancel.addEventListener('click', closeConfirmDialog);
confirmDelete.addEventListener('click', () => {
  if (deletingId) {
    const li = todoList.querySelector(`[data-id="${deletingId}"]`);
    if (li) {
      li.classList.add('removing');
      setTimeout(() => deleteTodo(deletingId), 250);
    } else {
      deleteTodo(deletingId);
    }
  }
  closeConfirmDialog();
});
confirmDialog.addEventListener('click', e => { if (e.target === confirmDialog) closeConfirmDialog(); });

// ===== Init =====
updateImageUploadUI(addImages, addImagePreview, addImageCount, addImageBtn);

if (restoreSession()) {
  showAppView();
} else {
  showAuthView();
}
