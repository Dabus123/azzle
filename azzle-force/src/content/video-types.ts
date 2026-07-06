import { z } from "zod";

export const VideoActionSchema = z.object({
  type: z.enum(["text", "glow", "line", "rect"]),
  start: z.number().min(0),
  end: z.number().min(0),
  x: z.number().default(0),
  y: z.number().default(0),
  x2: z.number().optional(),
  y2: z.number().optional(),
  content: z.string().optional(),
  font_size: z.number().optional(),
  color: z.string().optional(),
  fill: z.string().optional(),
  opacity: z.number().min(0).max(1).optional(),
  radius: z.number().optional(),
});

export const VideoTimelineSchema = z.object({
  title: z.string().min(4).max(80),
  subtitle: z.string().max(140).optional(),
  cta: z.string().max(48).optional(),
  duration_sec: z.number().min(3).max(20).default(8),
  fps: z.number().min(24).max(30).default(30),
  width: z.number().default(1920),
  height: z.number().default(1080),
  palette: z
    .object({
      background: z.string().default("#120818"),
      accent: z.string().default("#ff2d9a"),
      glow: z.string().default("#a855f7"),
      secondary: z.string().default("#39ff14"),
      text: z.string().default("#ffffff"),
    })
    .default({}),
  actions: z.array(VideoActionSchema).min(1).max(40),
  tweet_caption: z.string().min(10).max(280),
});

export type VideoAction = z.infer<typeof VideoActionSchema>;
export type VideoTimeline = z.infer<typeof VideoTimelineSchema>;
