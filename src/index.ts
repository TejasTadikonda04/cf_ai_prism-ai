import { DurableObject } from "cloudflare:workers";

// Define the expected Environment bindings
export interface Env {
  AI: any;
  HISTORY: DurableObjectNamespace;
}

// --- COMPONENT 1: THE MEMORY (Durable Object) ---
// This class runs inside a specific shard of memory. It saves the palettes.
export class PaletteHistory extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 1. Save a new palette
    if (request.method === "POST") {
      const palette = await request.json();
      // Generate a timestamp ID so we can sort later
      const id = Date.now().toString(); 
      await this.ctx.storage.put(id, palette);
      return new Response("Saved", { status: 201 });
    }

    // 2. Retrieve history
    if (request.method === "GET") {
      // Get all stored palettes (Map<string, any>)
      const stored = await this.ctx.storage.list({ reverse: true, limit: 50 });
      return new Response(JSON.stringify(Object.fromEntries(stored)), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Method Not Allowed", { status: 405 });
  }
}

// --- COMPONENT 2: THE COORDINATOR (Worker) ---
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // --- CORS HANDLER (Allows your frontend to talk to this backend) ---
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // --- ROUTE 1: GENERATE PALETTE (Uses AI) ---
    if (request.method === "POST" && url.pathname === "/api/generate") {
      try {
        const { text, userId } = await request.json() as any;

        if (!text) return new Response("Missing text input", { status: 400, headers: corsHeaders });

        // A. The System Prompt (The "Synesthesia" Logic)
        const messages = [
          {
            role: "system",
            content: `You are Prism AI, a synesthesia engine. You convert text into color palettes.
            Rules:
            1. Analyze the input for mood, emotion, and imagery.
            2. Generate 5 hex codes.
            3. Output ONLY raw JSON. No markdown, no backticks, no conversation.
            
            JSON Schema:
            {
              "name": "Creative Name",
              "colors": ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"],
              "description": "One short sentence explaining the vibe."
            }`
          },
          { role: "user", content: text }
        ];

        // B. Run Inference (Llama 3.3)
        const aiResponse: any = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
          messages,
        });

        // C. Clean up the response (Llama sometimes adds extra text, we try to parse just the JSON)
        let palette;
        try {
            // Sometimes models wrap JSON in markdown code blocks like ```json ... ```
            const raw = aiResponse.response.replace(/```json|```/g, "").trim();
            palette = JSON.parse(raw);
        } catch (e) {
            // Fallback if JSON parsing fails
            return new Response(JSON.stringify({ error: "AI generation failed format", raw: aiResponse.response }), { status: 500, headers: corsHeaders });
        }

        // D. Save to History (Durable Object)
        // We use the 'userId' (or IP) to find the specific Durable Object instance for this user
        const id = env.HISTORY.idFromName(userId || "default-user"); 
        const stub = env.HISTORY.get(id);
        
        // Send the generated palette to the DO to be saved
        // We don't await this (fire and forget) to make the UI feel faster
        ctx.waitUntil(stub.fetch("http://internal/save", {
            method: "POST",
            body: JSON.stringify({ ...palette, original_text: text, timestamp: Date.now() })
        }));

        return new Response(JSON.stringify(palette), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });

      } catch (err) {
        return new Response(JSON.stringify({ error: "Server Error", details: String(err) }), { status: 500, headers: corsHeaders });
      }
    }

    // --- ROUTE 2: GET HISTORY (Read from Durable Object) ---
    if (request.method === "GET" && url.pathname === "/api/history") {
        const userId = url.searchParams.get("userId") || "default-user";
        const id = env.HISTORY.idFromName(userId);
        const stub = env.HISTORY.get(id);

        const historyResponse = await stub.fetch("http://internal/history");
        const historyData = await historyResponse.text();

        return new Response(historyData, {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
};