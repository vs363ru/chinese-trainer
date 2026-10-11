'use strict';

(() => {
  const OWNER = 'vs363ru';
  const REPO = 'chinese-trainer';
  const IMAGE_PATH = 'images/reward.jpg';
  const API_ORIGIN = 'https://api.github.com';
  const REPO_PATH = `/repos/${OWNER}/${REPO}`;
  const MAX_INPUT_BYTES = 20 * 1024 * 1024;
  const MAX_SIDE = 1600;
  const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const el = id => document.getElementById(id);
  let token = '';
  let branch = 'main';
  let busy = false;
  let selected = null;
  let previewUrl = '';
  let selectionGeneration = 0;
  let sessionGeneration = 0;

  function status(message, error = false) {
    el('status').textContent = message;
    el('status').classList.toggle('error', error);
  }

  function controls() {
    const authenticated = Boolean(token);
    el('login-panel').hidden = authenticated;
    el('owner-panel').hidden = !authenticated;
    el('login-button').disabled = busy;
    el('github-token').disabled = busy;
    el('logout-button').disabled = busy;
    el('reward-file').disabled = busy || !authenticated;
    el('publish-button').disabled = busy || !authenticated || !selected;
    el('remove-button').disabled = busy || !authenticated;
  }

  function clearSelection() {
    selectionGeneration++;
    selected = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    el('reward-file').value = '';
    el('preview-image').removeAttribute('src');
    el('preview-image').hidden = true;
    el('preview-empty').hidden = false;
    el('file-note').textContent = 'JPG, PNG или WebP, до 20 МБ. Изображение будет уменьшено до 1600 пикселей.';
  }

  function lock(message = '') {
    sessionGeneration++;
    token = '';
    busy = false;
    el('github-token').value = '';
    clearSelection();
    controls();
    status(message);
  }

  function apiError(httpStatus) {
    const messages = {
      401: 'Ключ недействителен или срок его действия истёк. Создайте новый ключ и войдите заново.',
      403: 'GitHub не разрешил действие. Проверьте доступ к chinese-trainer, право Contents → Read and write и срок действия ключа.',
      404: 'Репозиторий или файл недоступен. Проверьте, что ключ выдан для chinese-trainer.',
      409: 'Файл изменился во время публикации. Повторите действие — текущая версия будет проверена заново.',
      422: 'GitHub не принял изменение. Проверьте права ключа и повторите действие.',
      429: 'GitHub временно ограничил запросы. Повторите позже.'
    };
    const error = new Error(messages[httpStatus] || `Ошибка GitHub (${httpStatus}). Повторите позже.`);
    error.httpStatus = httpStatus;
    return error;
  }

  async function api(path, key, options = {}) {
    if (!key) throw new Error('Сначала войдите в аккаунт владельца.');
    let response;
    try {
      response = await fetch(API_ORIGIN + path, {
        method: options.method || 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${key}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(options.body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer'
      });
    } catch (_) {
      throw new Error('Не удалось связаться с GitHub. Проверьте подключение и повторите действие.');
    }
    if (options.allowMissing && response.status === 404) return null;
    if (!response.ok) throw apiError(response.status);
    try { return await response.json(); }
    catch (_) { throw new Error('GitHub вернул неожиданный ответ. Повторите действие.'); }
  }

  async function login(event) {
    event.preventDefault();
    if (busy) return;
    let candidate = el('github-token').value.trim();
    el('github-token').value = '';
    if (!candidate) { status('Вставьте ключ доступа GitHub.', true); return; }
    const generation = ++sessionGeneration;
    busy = true;
    controls();
    status('Проверяю аккаунт и доступ к репозиторию…');
    try {
      const user = await api('/user', candidate);
      if (generation !== sessionGeneration) return;
      if (String(user.login || '').toLowerCase() !== OWNER) throw new Error('Публикация разрешена только владельцу vs363ru. Войдите с ключом этого аккаунта.');
      const repo = await api(REPO_PATH, candidate);
      if (String(repo.owner?.login || '').toLowerCase() !== OWNER || repo.name !== REPO || repo.permissions?.push === false) {
        throw new Error('Этот ключ не даёт доступа к публикации в chinese-trainer.');
      }
      if (generation !== sessionGeneration) return;
      token = candidate;
      branch = repo.default_branch || 'main';
      status('Вход выполнен. Выберите изображение и опубликуйте его для всех.');
    } catch (error) {
      if (generation === sessionGeneration) { token = ''; status(error.message, true); }
    } finally {
      candidate = '';
      if (generation === sessionGeneration) { busy = false; controls(); }
    }
  }

  async function prepareImage(file) {
    if (!ALLOWED_TYPES.has(file.type)) throw new Error('Поддерживаются только JPG, PNG и WebP. Сохраните HEIC как JPG перед загрузкой.');
    if (file.size > MAX_INPUT_BYTES) throw new Error('Выберите изображение размером до 20 МБ.');
    if (!file.size) throw new Error('Файл пуст. Выберите другое изображение.');
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => header[index] === byte);
    const webp = String.fromCharCode(...header.slice(0, 4)) === 'RIFF' && String.fromCharCode(...header.slice(8, 12)) === 'WEBP';
    if (!((file.type === 'image/jpeg' && jpeg) || (file.type === 'image/png' && png) || (file.type === 'image/webp' && webp))) {
      throw new Error('Формат содержимого файла не соответствует JPG, PNG или WebP. Выберите корректное изображение.');
    }
    const source = URL.createObjectURL(file);
    const image = new Image();
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('Не удалось прочитать изображение. Выберите другой JPG, PNG или WebP.'));
        image.src = source;
      });
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('Изображение не содержит корректных размеров.');
      const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Браузер не поддерживает обработку изображений. Откройте страницу в Safari или Chrome.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .88));
      if (!blob || blob.type !== 'image/jpeg') throw new Error('Не удалось подготовить JPG. Попробуйте другое изображение.');
      return { blob, width: canvas.width, height: canvas.height };
    } finally {
      image.src = '';
      URL.revokeObjectURL(source);
    }
  }

  async function chooseImage() {
    if (!token || busy) return;
    const file = el('reward-file').files?.[0];
    clearSelection();
    if (!file) { controls(); return; }
    const generation = selectionGeneration;
    const session = sessionGeneration;
    busy = true;
    controls();
    status('Подготавливаю изображение…');
    try {
      const prepared = await prepareImage(file);
      if (generation !== selectionGeneration || session !== sessionGeneration || !token) return;
      selected = prepared;
      previewUrl = URL.createObjectURL(prepared.blob);
      el('preview-image').src = previewUrl;
      el('preview-image').hidden = false;
      el('preview-empty').hidden = true;
      el('file-note').textContent = `${prepared.width} × ${prepared.height} пикселей · ${Math.ceil(prepared.blob.size / 1024)} КБ · JPG`;
      status('Предпросмотр готов. Нажмите «Опубликовать для всех».');
    } catch (error) {
      if (session === sessionGeneration) status(error.message, true);
    } finally {
      if (session === sessionGeneration) { busy = false; controls(); }
    }
  }

  async function base64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    }
    return btoa(binary);
  }

  async function currentImage(key) {
    const existing = await api(`${REPO_PATH}/contents/${IMAGE_PATH}?ref=${encodeURIComponent(branch)}`, key, { allowMissing: true });
    if (existing && (existing.type !== 'file' || !existing.sha)) throw new Error('Путь фотографии занят другим объектом. Проверьте images/reward.jpg в GitHub.');
    return existing;
  }

  async function publish() {
    if (!token || busy || !selected) return;
    const key = token;
    const session = sessionGeneration;
    const image = selected;
    busy = true;
    controls();
    status('Публикую общий фон…');
    try {
      const content = await base64(image.blob);
      if (session !== sessionGeneration) return;
      const existing = await currentImage(key);
      if (session !== sessionGeneration) return;
      await api(`${REPO_PATH}/contents/${IMAGE_PATH}`, key, {
        method: 'PUT',
        body: { message: 'Update shared trainer reward image', branch, content, ...(existing ? { sha: existing.sha } : {}) }
      });
      if (session === sessionGeneration) status('Фотография опубликована. Дождитесь обновления GitHub Pages и перезагрузите тренажёр.');
    } catch (error) {
      if (session === sessionGeneration) {
        if (error.httpStatus === 401) lock();
        status(error.message, true);
      }
    } finally {
      if (session === sessionGeneration) { busy = false; controls(); }
    }
  }

  async function remove() {
    if (!token || busy) return;
    if (!window.confirm('Убрать общую фотографию из тренажёра для всех участников?')) return;
    const key = token;
    const session = sessionGeneration;
    busy = true;
    controls();
    status('Убираю общий фон…');
    try {
      const existing = await currentImage(key);
      if (session !== sessionGeneration) return;
      if (existing) {
        await api(`${REPO_PATH}/contents/${IMAGE_PATH}`, key, {
          method: 'DELETE',
          body: { message: 'Remove shared trainer reward image', branch, sha: existing.sha }
        });
      }
      if (session === sessionGeneration) {
        clearSelection();
        status(existing ? 'Общий фон удалён. Дождитесь обновления GitHub Pages.' : 'Общая фотография ещё не опубликована.');
      }
    } catch (error) {
      if (session === sessionGeneration) {
        if (error.httpStatus === 401) lock();
        status(error.message, true);
      }
    } finally {
      if (session === sessionGeneration) { busy = false; controls(); }
    }
  }

  function sizePhonePreview() {
    if (el('phone-preview').hidden) return;
    const space = el('phone-space').getBoundingClientRect();
    const scale = Math.max(.1, Math.min(1, space.width / 375, space.height / 667));
    el('device-frame').style.width = `${375 * scale}px`;
    el('device-frame').style.height = `${667 * scale}px`;
    el('trainer-preview').style.transform = `scale(${scale})`;
  }

  function showPhonePreview() {
    el('admin-panel').hidden = true;
    el('phone-preview').hidden = false;
    document.body.classList.add('previewing');
    if (!el('trainer-preview').getAttribute('src')) el('trainer-preview').src = './index.html';
    sizePhonePreview();
    el('preview-back-button').focus();
  }

  function hidePhonePreview() {
    el('phone-preview').hidden = true;
    el('admin-panel').hidden = false;
    document.body.classList.remove('previewing');
    el('preview-phone-button').focus();
  }

  el('login-form').addEventListener('submit', login);
  el('logout-button').addEventListener('click', () => lock('Вы вышли. Ключ удалён из памяти страницы.'));
  el('reward-file').addEventListener('change', chooseImage);
  el('publish-button').addEventListener('click', publish);
  el('remove-button').addEventListener('click', remove);
  el('preview-phone-button').addEventListener('click', showPhonePreview);
  el('preview-back-button').addEventListener('click', hidePhonePreview);
  window.addEventListener('resize', sizePhonePreview);
  window.addEventListener('pagehide', () => lock());
  window.addEventListener('pageshow', event => { if (event.persisted) lock(); });
  controls();
})();
