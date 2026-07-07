import { getStore } from "@netlify/blobs";

const STORE_NAME = "gazette-seen-posts";

function idOf(post) {
  return String(post.iulaan_id ?? post.id);
}

export async function filterUnseen(posts) {
  if (posts.length === 0) return [];
  
  const store = getStore(STORE_NAME);
  
  // Check each post individually
  const unseenPosts = [];
  for (const post of posts) {
    const id = idOf(post);
    const exists = await store.get(id);
    if (!exists) {
      unseenPosts.push(post);
    }
  }
  
  return unseenPosts;
}

export async function markSeen(posts) {
  if (posts.length === 0) return;
  
  const store = getStore(STORE_NAME);
  
  // Set each post individually with proper error handling
  for (const post of posts) {
    const id = idOf(post);
    await store.set(id, new Date().toISOString());
  }
}

export async function closeStore() {
  // No cleanup needed for Blobs
}
