/**
 * Calculates the number of seconds remaining for an assessment attempt.
 *
 * @param {Date|{toDate?: () => Date}|string|number} startedAt - When the student started the attempt
 * @param {number} timeLimitMinutes - Time limit in minutes
 * @param {number} [gracePeriodMinutes=0] - Additional grace period in minutes
 * @returns {number} Seconds remaining (0 if time has expired)
 */
export function calculateTimeRemaining(startedAt, timeLimitMinutes, gracePeriodMinutes = 0) {
  if (!startedAt || !timeLimitMinutes) return Infinity;

  const start = toDate(startedAt);
  const totalAllowedMs = (timeLimitMinutes + gracePeriodMinutes) * 60 * 1000;
  const deadline = new Date(start.getTime() + totalAllowedMs);
  const now = new Date();
  const remainingMs = deadline.getTime() - now.getTime();

  return Math.max(0, Math.floor(remainingMs / 1000));
}

/**
 * Formats total seconds into a human-readable time string.
 * Returns "HH:MM:SS" if hours > 0, otherwise "MM:SS".
 *
 * @param {number} totalSeconds - Total seconds to format
 * @returns {string} Formatted time string
 */
export function formatTime(totalSeconds) {
  if (totalSeconds === Infinity) return '--:--';
  if (totalSeconds <= 0) return '00:00';

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const pad = (n) => String(n).padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Determines if the timer is in a critical state (under 5 minutes remaining).
 * Useful for applying red/urgent styling to the timer display.
 *
 * @param {number} secondsRemaining - Seconds left on the timer
 * @returns {boolean} True if under 5 minutes (300 seconds)
 */
export function isTimerCritical(secondsRemaining) {
  return secondsRemaining <= 300 && secondsRemaining > 0;
}

/**
 * Converts various date formats to a Date object.
 * @param {Date|{toDate?: () => Date}|string|number} value
 * @returns {Date}
 */
function toDate(value) {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === 'function') return value.toDate();
  return new Date(value);
}
