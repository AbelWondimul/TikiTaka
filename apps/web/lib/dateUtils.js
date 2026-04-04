/**
 * Returns a human-readable relative time string (e.g., "Just now", "5m ago", "3h ago", "2d ago").
 * Accepts Firestore Timestamps, Date objects, or ISO strings.
 */
export function getRelativeTime(timestamp) {
  if (!timestamp) return '';
  const date = timestamp instanceof Date
    ? timestamp
    : timestamp.toDate
      ? timestamp.toDate()
      : new Date(timestamp);
  const diff = Math.floor((Date.now() - date) / 1000 / 60);
  if (diff < 1) return 'Just now';
  if (diff < 60) return `${diff}m ago`;
  const hours = Math.floor(diff / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Formats a time string (HH:MM) or Firestore Timestamp into "H:MM AM/PM".
 */
export function formatTime(timestamp) {
  if (!timestamp) return '';
  let h, m;
  if (typeof timestamp === 'string' && timestamp.includes(':')) {
    [h, m] = timestamp.split(':').map(Number);
  } else {
    const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    h = d.getHours();
    m = d.getMinutes();
  }
  const suffix = h >= 12 ? 'PM' : 'AM';
  const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${display}:${m.toString().padStart(2, '0')} ${suffix}`;
}
