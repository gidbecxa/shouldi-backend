import { Injectable } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";

@Injectable()
export class SupabaseService {
  private client: SupabaseClient | null = null;

  getAdminClient() {
    if (this.client) {
      return this.client;
    }

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;

    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required.");
    }

    this.client = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      // Node.js < 22 has no native WebSocket; provide the 'ws' implementation
      // so the RealtimeClient (created internally by createClient) can start.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      realtime: { transport: WebSocket as any },
    });

    return this.client;
  }
}
