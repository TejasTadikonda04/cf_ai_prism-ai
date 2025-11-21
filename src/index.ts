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
    const path = url.pathname;

    // 1. Save a new palette
    if (request.method === "POST" && (path === "/save" || path === "/internal/save")) {
      try {
        const palette: any = await request.json();
        // Generate a unique ID: timestamp + random suffix to avoid collisions
        // Format: timestamp-random (e.g., "1234567890-abc123")
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(2, 9);
        const id = `${timestamp}-${randomSuffix}`;
        
        // Ensure the palette has a timestamp for sorting
        if (!palette.timestamp) {
          palette.timestamp = timestamp;
        }
        
        await this.ctx.storage.put(id, palette);
        return new Response(JSON.stringify({ success: true, id }), { 
          status: 201,
          headers: { "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: "Failed to save palette", details: String(e) }), { 
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // 2. Retrieve history
    if (request.method === "GET" && (path === "/history" || path === "/internal/history")) {
      try {
        // Get all stored palettes (Map<string, any>)
        // Use list() without limit first to get all, then sort
        const stored = await this.ctx.storage.list();
        
        // Convert Map to array, sort by timestamp (newest first), then limit
        const items: Array<[string, any]> = [];
        for (const [key, value] of stored.entries()) {
          items.push([key, value]);
        }
        
        // Sort by timestamp (newest first)
        items.sort((a, b) => {
          const timeA = a[1]?.timestamp || 0;
          const timeB = b[1]?.timestamp || 0;
          return timeB - timeA; // Descending order (newest first)
        });
        
        // Limit to 50 most recent
        const limited = items.slice(0, 50);
        
        // Convert back to object for JSON serialization
        const historyObj: Record<string, any> = {};
        for (const [key, value] of limited) {
          historyObj[key] = value;
        }
        
        return new Response(JSON.stringify(historyObj), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: "Failed to retrieve history", details: String(e) }), { 
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    return new Response(JSON.stringify({ error: "Method Not Allowed" }), { 
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
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
            // Check if aiResponse exists and has a response property
            if (!aiResponse) {
                return new Response(JSON.stringify({ error: "AI returned no response" }), { status: 500, headers: corsHeaders });
            }

            // Handle different possible response formats
            let rawText: string;
            if (typeof aiResponse === 'string') {
                rawText = aiResponse;
            } else if (aiResponse.response) {
                // Ensure response is a string
                rawText = typeof aiResponse.response === 'string' 
                    ? aiResponse.response 
                    : JSON.stringify(aiResponse.response);
            } else if (aiResponse.text) {
                // Ensure text is a string
                rawText = typeof aiResponse.text === 'string' 
                    ? aiResponse.text 
                    : JSON.stringify(aiResponse.text);
            } else {
                // Try to stringify and parse if it's already an object
                rawText = JSON.stringify(aiResponse);
            }

            // Sometimes models wrap JSON in markdown code blocks like ```json ... ```
            const cleaned = rawText.replace(/```json|```/g, "").trim();
            
            // Try to extract JSON if there's extra text around it
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            const jsonString = jsonMatch ? jsonMatch[0] : cleaned;
            
            palette = JSON.parse(jsonString);

            // Validate the palette structure
            if (!palette || !palette.colors || !Array.isArray(palette.colors)) {
                return new Response(JSON.stringify({ 
                    error: "AI response missing colors array", 
                    received: palette,
                    raw: rawText.substring(0, 200) 
                }), { status: 500, headers: corsHeaders });
            }

            // Ensure we have at least some colors
            if (palette.colors.length === 0) {
                return new Response(JSON.stringify({ 
                    error: "AI returned empty colors array",
                    received: palette 
                }), { status: 500, headers: corsHeaders });
            }

        } catch (e) {
            // Fallback if JSON parsing fails
            let rawPreview = "No response";
            if (aiResponse) {
                try {
                    let rawValue: any;
                    if (aiResponse.response !== undefined) {
                        rawValue = aiResponse.response;
                    } else if (aiResponse.text !== undefined) {
                        rawValue = aiResponse.text;
                    } else {
                        rawValue = aiResponse;
                    }
                    
                    // Convert to string safely
                    const rawString = typeof rawValue === 'string' 
                        ? rawValue 
                        : JSON.stringify(rawValue);
                    rawPreview = rawString.substring(0, 200);
                } catch (previewError) {
                    rawPreview = "Could not extract response preview";
                }
            }
            
            return new Response(JSON.stringify({ 
                error: "AI generation failed to parse", 
                details: String(e),
                raw: rawPreview
            }), { status: 500, headers: corsHeaders });
        }

        // D. Save to History (Durable Object)
        // We use the 'userId' (or IP) to find the specific Durable Object instance for this user
        const id = env.HISTORY.idFromName(userId || "default-user"); 
        const stub = env.HISTORY.get(id);
        
        // Send the generated palette to the DO to be saved
        // We await this to ensure it's saved before returning, but use waitUntil for background processing
        const savePromise = stub.fetch("http://internal/save", {
            method: "POST",
            body: JSON.stringify({ ...palette, original_text: text, timestamp: Date.now() })
        });
        
        // Use waitUntil to ensure it completes even if the response is sent first
        ctx.waitUntil(savePromise);
        
        // Also await it to ensure it's saved (this won't block the response too long)
        try {
            await savePromise;
        } catch (saveError) {
            // Log but don't fail the request if save fails
            console.error("Failed to save palette to history:", saveError);
        }

        return new Response(JSON.stringify(palette), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });

      } catch (err) {
        return new Response(JSON.stringify({ error: "Server Error", details: String(err) }), { status: 500, headers: corsHeaders });
      }
    }

    // --- ROUTE 2: GET HISTORY (Read from Durable Object) ---
    if (request.method === "GET" && url.pathname === "/api/history") {
        try {
            const userId = url.searchParams.get("userId") || "default-user";
            const id = env.HISTORY.idFromName(userId);
            const stub = env.HISTORY.get(id);

            const historyResponse = await stub.fetch("http://internal/history");
            
            if (!historyResponse.ok) {
                return new Response(JSON.stringify({ 
                    error: "Failed to retrieve history", 
                    status: historyResponse.status 
                }), { 
                    status: historyResponse.status,
                    headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            }

            const historyData = await historyResponse.text();

            return new Response(historyData, {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        } catch (err) {
            return new Response(JSON.stringify({ 
                error: "Server Error retrieving history", 
                details: String(err) 
            }), { 
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
};