export type Category = "Life" | "Love" | "Career" | "Money" | "Health" | "Fun" | "Other";

export type VoteValue = "yes" | "no";

export interface User {
  id: string;
  device_id: string;
  push_token: string | null;
  is_banned: boolean;
  created_at: string;
}

export interface Question {
  id: string;
  user_id: string;
  text: string;
  category: Category;
  status: "active" | "closed" | "flagged" | "deleted";
  yes_count: number;
  no_count: number;
  expires_at: string;
  created_at: string;
}

export interface ApiErrorResponse {
  error: string;
  message?: string;
}

declare global {
  namespace Express {
    interface Request {
      deviceId?: string;
    }
  }
}

export {};
