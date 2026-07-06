/** Parsed Reddit thread from search API. */

export interface RedditThread {
  postId: string;
  subreddit: string;
  title: string;
  selftext: string;
  url: string;
  permalink: string;
  score: number;
  numComments: number;
  createdUtc: number;
  author: string;
  over18: boolean;
  stickied: boolean;
}

export function threadEntityName(thread: RedditThread): string {
  return `r/${thread.subreddit}: ${thread.title.slice(0, 120)}`;
}

export function threadMetadata(thread: RedditThread): Record<string, unknown> {
  return {
    reddit: {
      post_id: thread.postId,
      subreddit: thread.subreddit,
      title: thread.title,
      selftext: thread.selftext.slice(0, 4000),
      url: thread.url,
      permalink: thread.permalink,
      score: thread.score,
      num_comments: thread.numComments,
      created_utc: thread.createdUtc,
      author: thread.author,
    },
    contact_methods: [`reddit:thread:${thread.postId}`],
  };
}
