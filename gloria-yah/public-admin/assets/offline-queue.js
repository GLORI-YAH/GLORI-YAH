// Quand le réseau coupe pendant que le pilote accepte/termine une course, on ne
// perd pas l'action : elle est stockée localement (IndexedDB via localStorage
// simplifié ici) et renvoyée automatiquement dès que le réseau revient.

const OFFLINE_QUEUE_KEY = 'gy_offline_queue';

function getQueue() {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveQueue(queue) {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

/**
 * À utiliser à la place d'un apiFetch direct pour les actions critiques
 * (accepter une course, la terminer) : si le réseau échoue, l'action est
 * mise en file d'attente au lieu d'être perdue.
 */
async function apiFetchResilient(path, options = {}) {
  try {
    return await apiFetch(path, options);
  } catch (err) {
    if (!navigator.onLine) {
      const queue = getQueue();
      queue.push({ path, options, queuedAt: Date.now() });
      saveQueue(queue);
      showOfflineBanner(`Action mise en attente — sera envoyée dès que le réseau revient (${queue.length} en attente)`);
      throw new Error('OFFLINE_QUEUED');
    }
    throw err;
  }
}

async function flushOfflineQueue() {
  const queue = getQueue();
  if (queue.length === 0) return;

  const remaining = [];
  for (const item of queue) {
    try {
      await apiFetch(item.path, item.options);
    } catch (err) {
      remaining.push(item); // on la garde pour la prochaine tentative
    }
  }
  saveQueue(remaining);
  if (remaining.length === 0) {
    hideOfflineBanner();
  }
}

function showOfflineBanner(text) {
  let banner = document.getElementById('offlineBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'offlineBanner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#A91D22;color:white;text-align:center;padding:10px;font-weight:700;z-index:9999;';
    document.body.prepend(banner);
  }
  banner.textContent = text;
  banner.style.display = 'block';
}

function hideOfflineBanner() {
  const banner = document.getElementById('offlineBanner');
  if (banner) banner.style.display = 'none';
}

window.addEventListener('online', () => {
  hideOfflineBanner();
  flushOfflineQueue();
});

window.addEventListener('offline', () => {
  showOfflineBanner('Hors-ligne — l\'application continue de fonctionner, vos actions seront envoyées dès le retour du réseau.');
});

// Au chargement, tenter d'envoyer toute action restée en attente d'une session précédente
document.addEventListener('DOMContentLoaded', () => {
  if (navigator.onLine) flushOfflineQueue();
});
