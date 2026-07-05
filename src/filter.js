const KEYWORDS = [
  "software",
  "developer",
  "programmer",
  "web site",
  "website",
  "web development",
  "application development",
  "mobile app",
  "mobile application",
  "system",
  "backend",
  "front end",
  "frontend",
  "full stack",
  "fullstack",
  "api",
  "laravel",
  "php",
  "flutter",
  "devops",
  "database developer",
  "programming",
  "it officer",
  "information technology",
];

const CATEGORY_SLUGS = new Set(["information-technology"]);

function textOf(post) {
  return `${post.title ?? ""} ${post.description ?? post.details ?? ""}`.toLowerCase();
}

export function isItRelated(post) {
  const category = (post.category?.slug ?? post.category ?? "").toLowerCase();
  if (CATEGORY_SLUGS.has(category)) return true;

  const text = textOf(post);
  return KEYWORDS.some((keyword) => text.includes(keyword));
}
