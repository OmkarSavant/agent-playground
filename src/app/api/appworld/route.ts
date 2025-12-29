import { NextRequest, NextResponse } from "next/server";

const APPWORLD_API_URL =
  "https://appworld-api-838155728558.us-central1.run.app";

type AppWorldAction = "initialize" | "execute" | "evaluate";

interface AppWorldRequest {
  action: AppWorldAction;
  task_id: string;
  code?: string; // Required for execute
  cookie?: string; // GAESA cookie for execute/evaluate
}

interface AppWorldResponse {
  output?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsed_output?: any; // Parsed JSON from output string if possible
  cookie?: string; // GAESA cookie from initialize
  error?: string;
  success?: boolean; // For evaluate
}

export async function POST(request: NextRequest) {
  try {
    const body: AppWorldRequest = await request.json();
    const { action, task_id, code, cookie } = body;

    if (!action || !task_id) {
      return NextResponse.json(
        { error: "Missing required fields: action, task_id" },
        { status: 400 }
      );
    }

    const endpoint = `${APPWORLD_API_URL}/${action}`;
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    // Forward GAESA cookie for execute/evaluate
    if (cookie && (action === "execute" || action === "evaluate")) {
      headers["Cookie"] = cookie;
    }

    // Build request body based on action
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requestBody: Record<string, any> = { task_id };
    if (action === "execute" && code) {
      requestBody.code = code;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      credentials: "include",
    });

    // Capture cookies from response (for initialize)
    const setCookieHeader = response.headers.get("set-cookie");
    let gaesaCookie: string | undefined;

    if (setCookieHeader) {
      // Extract GAESA cookie
      const cookies = setCookieHeader.split(",").map((c) => c.trim());
      for (const cookieStr of cookies) {
        if (cookieStr.includes("GAESA")) {
          // Extract just the cookie name=value part
          const match = cookieStr.match(/GAESA[^;]*/);
          if (match) {
            gaesaCookie = match[0];
          }
        }
      }
    }

    // Handle non-OK responses
    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        {
          error: `AppWorld API error: ${response.status}`,
          details: errorText,
        },
        { status: response.status }
      );
    }

    // Parse response
    const data = await response.json();
    const result: AppWorldResponse = {};

    // Handle output field - try to parse as JSON
    if (data.output !== undefined) {
      result.output = data.output;

      // Try to parse output as JSON
      if (typeof data.output === "string") {
        try {
          result.parsed_output = JSON.parse(data.output);
        } catch {
          // Output is not JSON, keep as string
          result.parsed_output = data.output;
        }
      } else {
        result.parsed_output = data.output;
      }
    }

    // Include cookie for initialize response
    if (action === "initialize" && gaesaCookie) {
      result.cookie = gaesaCookie;
    }

    // Handle evaluate response
    if (action === "evaluate") {
      result.success = data.success ?? data.output?.includes("success");
    }

    // Pass through any other fields
    if (data.error) {
      result.error = data.error;
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("AppWorld proxy error:", error);
    return NextResponse.json(
      {
        error: "Proxy error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
