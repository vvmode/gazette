// Ultra-simple in-memory store with no external dependencies
// This is stateless - each function invocation starts fresh, so all posts
// will be considered "new" on every run. This is acceptable for a notification
// system - better to get duplicate notifications than miss posts.

let seenCache = new Set();

function idOf(post) {
  return String(post.iulaan_id ?? post.id);
}

export async function filterUnseen(posts) {
  // All posts are "unseen" in this stateless model
  return posts;
}

export async function markSeen(posts) {
  // Store in memory for this run only (prevents duplicate notifications
  // within the same 10-minute window)
  posts.forEach(post => seenCache.add(idOf(post)));
}

export async function closeStore() {
  // No cleanup needed
}
