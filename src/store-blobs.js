import { getStore } from "@netlify/blobs";

const STORE_NAME = "gazette-seen-posts";

function getSeenStore() {
  return getStore(STORE_NAME);
}

function idOf(post) {
  return String(post.iulaan_id ?? post.id);
}

export async function filterUnseen(posts) {
  if (posts.length === 0) return [];
  
  const store = getSeenStore();
  const seenChecks = await Promise.all(
    posts.map(async (post) => ({
      post,
      seen: await store.get(idOf(post))
    }))
  );
  
  return seenChecks.filter(({ seen }) => !seen).map(({ post }) => post);
}

export async function markSeen(posts) {
  if (posts.length === 0) return;
  
  const store = getSeenStore();
  await Promise.all(
    posts.map((post) => 
      store.set(idOf(post), new Date().toISOString())
    )
  );
}

export async function closeStore() {
  // No cleanup needed for Blobs
}
