import { z } from "zod";

// Helper to convert Zod schema to JSON Schema for LLM tools
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function zodToJsonSchema(schema: z.ZodType<any>): Record<string, any> {
  // Simple conversion for our use case
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const zodValue = value as z.ZodType<any>;
      properties[key] = zodTypeToJson(zodValue);
      if (!zodValue.isOptional()) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }
  return zodTypeToJson(schema);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function zodTypeToJson(schema: z.ZodType<any>): Record<string, any> {
  if (schema instanceof z.ZodString) {
    return { type: "string", description: schema.description };
  }
  if (schema instanceof z.ZodNumber) {
    return { type: "number", description: schema.description };
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: "boolean", description: schema.description };
  }
  if (schema instanceof z.ZodArray) {
    return {
      type: "array",
      items: zodTypeToJson(schema.element),
      description: schema.description,
    };
  }
  if (schema instanceof z.ZodOptional) {
    return zodTypeToJson(schema.unwrap());
  }
  if (schema instanceof z.ZodDefault) {
    const inner = zodTypeToJson(schema.removeDefault());
    return { ...inner, default: schema._def.defaultValue() };
  }
  if (schema instanceof z.ZodEnum) {
    return {
      type: "string",
      enum: schema.options,
      description: schema.description,
    };
  }
  return { type: "string" };
}

// Helper to format Python arguments
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatPythonArg(value: any): string {
  if (typeof value === "string") {
    // Escape quotes and newlines
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    return `"${escaped}"`;
  }
  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(formatPythonArg).join(", ")}]`;
  }
  if (value === null || value === undefined) {
    return "None";
  }
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .map(([k, v]) => `"${k}": ${formatPythonArg(v)}`)
      .join(", ");
    return `{${entries}}`;
  }
  return String(value);
}

// Helper to generate authenticated API call code
// This logs in, captures the access_token, and calls the API in one block
function makeAuthenticatedCall(
  service: string,
  apiMethod: string,
  username: string,
  password: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extraArgs?: Record<string, any>
): string {
  const argsStr = extraArgs
    ? Object.entries(extraArgs)
        .map(([k, v]) => `${k}=${formatPythonArg(v)}`)
        .join(", ")
    : "";
  const apiArgs = argsStr ? `access_token=access_token, ${argsStr}` : "access_token=access_token";

  return `login_result = apis.${service}.login(username=${formatPythonArg(username)}, password=${formatPythonArg(password)})
access_token = login_result["access_token"]
print(apis.${service}.${apiMethod}(${apiArgs}))`;
}

// Service function definition
export interface ServiceFunction {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: z.ZodType<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toCode: (args: Record<string, any>) => string;
}

export interface Service {
  name: string;
  displayName: string;
  description: string;
  functions: ServiceFunction[];
}

// ============================================================================
// BASE TOOLS (supervisor tools - always available to model)
// ============================================================================

export const baseTools: ServiceFunction[] = [
  {
    name: "supervisor_show_account_passwords",
    description:
      "Show all login credentials (usernames and passwords) for the current user across all services. Returns a list of {account_name, password} objects. Call this first to get authentication details.",
    schema: z.object({}),
    toCode: () => `print(apis.supervisor.show_account_passwords())`,
  },
  {
    name: "supervisor_show_profile",
    description:
      "Show the profile information of the current supervisor/user including name, email, and other personal details.",
    schema: z.object({}),
    toCode: () => `print(apis.supervisor.show_profile())`,
  },
  {
    name: "supervisor_complete_task",
    description:
      "Mark the current task as complete. Call this when you have finished the assigned task.",
    schema: z.object({}),
    toCode: () => `print(apis.supervisor.complete_task())`,
  },
];

// Internal tool for executing raw Python - NOT exposed to the model
// Used internally when we need to run custom code
export const executePythonTool: ServiceFunction = {
  name: "execute_python",
  description: "Execute arbitrary Python code (internal use only)",
  schema: z.object({
    code: z.string().describe("Python code to execute"),
  }),
  toCode: (args) => args.code,
};

// ============================================================================
// SPOTIFY SERVICE
// ============================================================================

const spotifyFunctions: ServiceFunction[] = [
  {
    name: "spotify_login",
    description: "Login to Spotify with username and password. Returns access_token for authenticated calls.",
    schema: z.object({
      username: z.string().describe("Spotify username (email)"),
      password: z.string().describe("Spotify password"),
    }),
    toCode: (args) =>
      `print(apis.spotify.login(username=${formatPythonArg(args.username)}, password=${formatPythonArg(args.password)}))`,
  },
  {
    name: "spotify_show_liked_songs",
    description: "Get a list of songs you have liked. Requires authentication.",
    schema: z.object({
      username: z.string().describe("Spotify username (email)"),
      password: z.string().describe("Spotify password"),
    }),
    toCode: (args) => makeAuthenticatedCall("spotify", "show_liked_songs", args.username, args.password),
  },
  {
    name: "spotify_show_account",
    description: "Show the current Spotify account details. Requires authentication.",
    schema: z.object({
      username: z.string().describe("Spotify username (email)"),
      password: z.string().describe("Spotify password"),
    }),
    toCode: (args) => makeAuthenticatedCall("spotify", "show_account", args.username, args.password),
  },
  {
    name: "spotify_search_songs",
    description: "Search for songs on Spotify. Does not require authentication.",
    schema: z.object({
      query: z.string().describe("Search query for songs"),
    }),
    toCode: (args) =>
      `print(apis.spotify.search_songs(query=${formatPythonArg(args.query)}))`,
  },
  {
    name: "spotify_search_artists",
    description: "Search for artists on Spotify. Does not require authentication.",
    schema: z.object({
      query: z.string().describe("Search query for artists"),
    }),
    toCode: (args) =>
      `print(apis.spotify.search_artists(query=${formatPythonArg(args.query)}))`,
  },
  {
    name: "spotify_search_albums",
    description: "Search for albums on Spotify. Does not require authentication.",
    schema: z.object({
      query: z.string().describe("Search query for albums"),
    }),
    toCode: (args) =>
      `print(apis.spotify.search_albums(query=${formatPythonArg(args.query)}))`,
  },
  {
    name: "spotify_search_playlists",
    description: "Search for playlists on Spotify. Does not require authentication.",
    schema: z.object({
      query: z.string().describe("Search query for playlists"),
    }),
    toCode: (args) =>
      `print(apis.spotify.search_playlists(query=${formatPythonArg(args.query)}))`,
  },
  {
    name: "spotify_show_playlist",
    description: "Show details of a playlist including its songs.",
    schema: z.object({
      playlist_id: z.number().describe("Playlist ID"),
    }),
    toCode: (args) =>
      `print(apis.spotify.show_playlist(playlist_id=${formatPythonArg(args.playlist_id)}))`,
  },
  {
    name: "spotify_play_music",
    description: "Play a song, album, or playlist on Spotify. Requires authentication.",
    schema: z.object({
      username: z.string().describe("Spotify username (email)"),
      password: z.string().describe("Spotify password"),
      song_id: z.number().optional().describe("Song ID to play"),
      album_id: z.number().optional().describe("Album ID to play"),
      playlist_id: z.number().optional().describe("Playlist ID to play"),
    }),
    toCode: (args) => {
      const extraArgs: Record<string, unknown> = {};
      if (args.song_id) extraArgs.song_id = args.song_id;
      if (args.album_id) extraArgs.album_id = args.album_id;
      if (args.playlist_id) extraArgs.playlist_id = args.playlist_id;
      return makeAuthenticatedCall("spotify", "play_music", args.username, args.password, extraArgs);
    },
  },
  {
    name: "spotify_show_song",
    description: "Get details of a specific song by ID.",
    schema: z.object({
      song_id: z.string().describe("The ID of the song"),
    }),
    toCode: (args) =>
      `print(apis.spotify.get_song(song_id=${formatPythonArg(args.song_id)}))`,
  },
  {
    name: "spotify_get_album",
    description: "Get details of a specific album by ID.",
    schema: z.object({
      album_id: z.string().describe("The ID of the album"),
    }),
    toCode: (args) =>
      `print(apis.spotify.get_album(album_id=${formatPythonArg(args.album_id)}))`,
  },
  {
    name: "spotify_show_artist",
    description: "Get details of a specific artist by ID.",
    schema: z.object({
      artist_id: z.number().describe("The ID of the artist"),
    }),
    toCode: (args) =>
      `print(apis.spotify.show_artist(artist_id=${formatPythonArg(args.artist_id)}))`,
  },
];

// ============================================================================
// GMAIL SERVICE
// ============================================================================

const gmailFunctions: ServiceFunction[] = [
  {
    name: "gmail_login",
    description: "Login to Gmail with username (email) and password. Returns access_token.",
    schema: z.object({
      username: z.string().describe("Gmail username (email address)"),
      password: z.string().describe("Gmail password"),
    }),
    toCode: (args) =>
      `print(apis.gmail.login(username=${formatPythonArg(args.username)}, password=${formatPythonArg(args.password)}))`,
  },
  {
    name: "gmail_show_inbox_threads",
    description: "Show email threads in the inbox. Requires authentication.",
    schema: z.object({
      username: z.string().describe("Gmail username (email)"),
      password: z.string().describe("Gmail password"),
    }),
    toCode: (args) => makeAuthenticatedCall("gmail", "show_inbox_threads", args.username, args.password),
  },
  {
    name: "gmail_show_outbox_threads",
    description: "Show sent email threads. Requires authentication.",
    schema: z.object({
      username: z.string().describe("Gmail username (email)"),
      password: z.string().describe("Gmail password"),
    }),
    toCode: (args) => makeAuthenticatedCall("gmail", "show_outbox_threads", args.username, args.password),
  },
  {
    name: "gmail_show_thread",
    description: "Get a specific email thread by ID. Requires authentication.",
    schema: z.object({
      username: z.string().describe("Gmail username (email)"),
      password: z.string().describe("Gmail password"),
      thread_id: z.number().describe("The ID of the email thread"),
    }),
    toCode: (args) =>
      makeAuthenticatedCall("gmail", "show_thread", args.username, args.password, { thread_id: args.thread_id }),
  },
  {
    name: "gmail_show_email",
    description: "Get a specific email by ID. Requires authentication.",
    schema: z.object({
      username: z.string().describe("Gmail username (email)"),
      password: z.string().describe("Gmail password"),
      email_id: z.number().describe("The ID of the email"),
    }),
    toCode: (args) =>
      makeAuthenticatedCall("gmail", "show_email", args.username, args.password, { email_id: args.email_id }),
  },
  {
    name: "gmail_send_email",
    description: "Send a new email. Requires authentication.",
    schema: z.object({
      username: z.string().describe("Gmail username (email)"),
      password: z.string().describe("Gmail password"),
      to: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject"),
      body: z.string().describe("Email body content"),
    }),
    toCode: (args) =>
      makeAuthenticatedCall("gmail", "send_email", args.username, args.password, {
        to: args.to,
        subject: args.subject,
        body: args.body,
      }),
  },
  {
    name: "gmail_reply_to_email",
    description: "Reply to an email. Requires authentication.",
    schema: z.object({
      username: z.string().describe("Gmail username (email)"),
      password: z.string().describe("Gmail password"),
      email_id: z.number().describe("The ID of the email to reply to"),
      body: z.string().describe("Reply body content"),
    }),
    toCode: (args) =>
      makeAuthenticatedCall("gmail", "reply_to_email", args.username, args.password, {
        email_id: args.email_id,
        body: args.body,
      }),
  },
  {
    name: "gmail_show_account",
    description: "Show Gmail account details. Requires authentication.",
    schema: z.object({
      username: z.string().describe("Gmail username (email)"),
      password: z.string().describe("Gmail password"),
    }),
    toCode: (args) => makeAuthenticatedCall("gmail", "show_account", args.username, args.password),
  },
];

// ============================================================================
// VENMO SERVICE
// ============================================================================

const venmoFunctions: ServiceFunction[] = [
  {
    name: "venmo_login",
    description: "Login to Venmo with username and password.",
    schema: z.object({
      username: z.string().describe("Venmo username"),
      password: z.string().describe("Venmo password"),
    }),
    toCode: (args) =>
      `print(apis.venmo.login(username=${formatPythonArg(args.username)}, password=${formatPythonArg(args.password)}))`,
  },
  {
    name: "venmo_show_account",
    description: "Show the current Venmo account details and balance.",
    schema: z.object({}),
    toCode: () => `print(apis.venmo.show_account())`,
  },
  {
    name: "venmo_get_balance",
    description: "Get the current Venmo balance.",
    schema: z.object({}),
    toCode: () => `print(apis.venmo.get_balance())`,
  },
  {
    name: "venmo_search_user",
    description: "Search for a Venmo user.",
    schema: z.object({
      query: z.string().describe("Search query (name or username)"),
    }),
    toCode: (args) =>
      `print(apis.venmo.search_user(query=${formatPythonArg(args.query)}))`,
  },
  {
    name: "venmo_pay",
    description: "Send a payment to another user.",
    schema: z.object({
      recipient: z.string().describe("Recipient username or user ID"),
      amount: z.number().describe("Amount to send"),
      note: z.string().describe("Payment note/description"),
    }),
    toCode: (args) =>
      `print(apis.venmo.pay(recipient=${formatPythonArg(args.recipient)}, amount=${args.amount}, note=${formatPythonArg(args.note)}))`,
  },
  {
    name: "venmo_request",
    description: "Request money from another user.",
    schema: z.object({
      recipient: z.string().describe("User to request from"),
      amount: z.number().describe("Amount to request"),
      note: z.string().describe("Request note/description"),
    }),
    toCode: (args) =>
      `print(apis.venmo.request(recipient=${formatPythonArg(args.recipient)}, amount=${args.amount}, note=${formatPythonArg(args.note)}))`,
  },
  {
    name: "venmo_show_transactions",
    description: "Show transaction history.",
    schema: z.object({
      limit: z.number().optional().describe("Maximum number of transactions to show"),
    }),
    toCode: (args) => {
      const limitArg = args.limit ? `limit=${args.limit}` : "";
      return `print(apis.venmo.show_transactions(${limitArg}))`;
    },
  },
  {
    name: "venmo_show_pending",
    description: "Show pending payment requests.",
    schema: z.object({}),
    toCode: () => `print(apis.venmo.show_pending())`,
  },
  {
    name: "venmo_accept_request",
    description: "Accept a pending payment request.",
    schema: z.object({
      request_id: z.string().describe("The ID of the request to accept"),
    }),
    toCode: (args) =>
      `print(apis.venmo.accept_request(request_id=${formatPythonArg(args.request_id)}))`,
  },
  {
    name: "venmo_decline_request",
    description: "Decline a pending payment request.",
    schema: z.object({
      request_id: z.string().describe("The ID of the request to decline"),
    }),
    toCode: (args) =>
      `print(apis.venmo.decline_request(request_id=${formatPythonArg(args.request_id)}))`,
  },
];

// ============================================================================
// AMAZON SERVICE
// ============================================================================

const amazonFunctions: ServiceFunction[] = [
  {
    name: "amazon_login",
    description: "Login to Amazon with email and password.",
    schema: z.object({
      email: z.string().describe("Amazon email address"),
      password: z.string().describe("Amazon password"),
    }),
    toCode: (args) =>
      `print(apis.amazon.login(email=${formatPythonArg(args.email)}, password=${formatPythonArg(args.password)}))`,
  },
  {
    name: "amazon_show_account",
    description: "Show the current Amazon account details.",
    schema: z.object({}),
    toCode: () => `print(apis.amazon.show_account())`,
  },
  {
    name: "amazon_search",
    description: "Search for products on Amazon.",
    schema: z.object({
      query: z.string().describe("Search query for products"),
      category: z.string().optional().describe("Category to search in"),
    }),
    toCode: (args) => {
      const params = [`query=${formatPythonArg(args.query)}`];
      if (args.category) params.push(`category=${formatPythonArg(args.category)}`);
      return `print(apis.amazon.search(${params.join(", ")}))`;
    },
  },
  {
    name: "amazon_get_product",
    description: "Get details of a specific product.",
    schema: z.object({
      product_id: z.string().describe("The ID of the product"),
    }),
    toCode: (args) =>
      `print(apis.amazon.get_product(product_id=${formatPythonArg(args.product_id)}))`,
  },
  {
    name: "amazon_show_cart",
    description: "Show the current shopping cart.",
    schema: z.object({}),
    toCode: () => `print(apis.amazon.show_cart())`,
  },
  {
    name: "amazon_add_to_cart",
    description: "Add a product to the shopping cart.",
    schema: z.object({
      product_id: z.string().describe("The ID of the product to add"),
      quantity: z.number().optional().describe("Quantity to add (default 1)"),
    }),
    toCode: (args) => {
      const params = [`product_id=${formatPythonArg(args.product_id)}`];
      if (args.quantity) params.push(`quantity=${args.quantity}`);
      return `print(apis.amazon.add_to_cart(${params.join(", ")}))`;
    },
  },
  {
    name: "amazon_remove_from_cart",
    description: "Remove a product from the shopping cart.",
    schema: z.object({
      product_id: z.string().describe("The ID of the product to remove"),
    }),
    toCode: (args) =>
      `print(apis.amazon.remove_from_cart(product_id=${formatPythonArg(args.product_id)}))`,
  },
  {
    name: "amazon_update_cart_quantity",
    description: "Update the quantity of a product in the cart.",
    schema: z.object({
      product_id: z.string().describe("The ID of the product"),
      quantity: z.number().describe("New quantity"),
    }),
    toCode: (args) =>
      `print(apis.amazon.update_cart_quantity(product_id=${formatPythonArg(args.product_id)}, quantity=${args.quantity}))`,
  },
  {
    name: "amazon_checkout",
    description: "Proceed to checkout and complete the purchase.",
    schema: z.object({
      address_id: z.string().optional().describe("Shipping address ID"),
      payment_method_id: z.string().optional().describe("Payment method ID"),
    }),
    toCode: (args) => {
      const params: string[] = [];
      if (args.address_id) params.push(`address_id=${formatPythonArg(args.address_id)}`);
      if (args.payment_method_id)
        params.push(`payment_method_id=${formatPythonArg(args.payment_method_id)}`);
      return `print(apis.amazon.checkout(${params.join(", ")}))`;
    },
  },
  {
    name: "amazon_show_orders",
    description: "Show order history.",
    schema: z.object({}),
    toCode: () => `print(apis.amazon.show_orders())`,
  },
  {
    name: "amazon_get_order",
    description: "Get details of a specific order.",
    schema: z.object({
      order_id: z.string().describe("The ID of the order"),
    }),
    toCode: (args) =>
      `print(apis.amazon.get_order(order_id=${formatPythonArg(args.order_id)}))`,
  },
  {
    name: "amazon_show_addresses",
    description: "Show saved shipping addresses.",
    schema: z.object({}),
    toCode: () => `print(apis.amazon.show_addresses())`,
  },
  {
    name: "amazon_show_payment_methods",
    description: "Show saved payment methods.",
    schema: z.object({}),
    toCode: () => `print(apis.amazon.show_payment_methods())`,
  },
];

// ============================================================================
// TODOIST SERVICE
// ============================================================================

const todoistFunctions: ServiceFunction[] = [
  {
    name: "todoist_login",
    description: "Login to Todoist with email and password.",
    schema: z.object({
      email: z.string().describe("Todoist email address"),
      password: z.string().describe("Todoist password"),
    }),
    toCode: (args) =>
      `print(apis.todoist.login(email=${formatPythonArg(args.email)}, password=${formatPythonArg(args.password)}))`,
  },
  {
    name: "todoist_show_account",
    description: "Show the current Todoist account details.",
    schema: z.object({}),
    toCode: () => `print(apis.todoist.show_account())`,
  },
  {
    name: "todoist_list_projects",
    description: "List all projects.",
    schema: z.object({}),
    toCode: () => `print(apis.todoist.list_projects())`,
  },
  {
    name: "todoist_get_project",
    description: "Get details of a specific project.",
    schema: z.object({
      project_id: z.string().describe("The ID of the project"),
    }),
    toCode: (args) =>
      `print(apis.todoist.get_project(project_id=${formatPythonArg(args.project_id)}))`,
  },
  {
    name: "todoist_create_project",
    description: "Create a new project.",
    schema: z.object({
      name: z.string().describe("Name of the project"),
      color: z.string().optional().describe("Color of the project"),
    }),
    toCode: (args) => {
      const params = [`name=${formatPythonArg(args.name)}`];
      if (args.color) params.push(`color=${formatPythonArg(args.color)}`);
      return `print(apis.todoist.create_project(${params.join(", ")}))`;
    },
  },
  {
    name: "todoist_delete_project",
    description: "Delete a project.",
    schema: z.object({
      project_id: z.string().describe("The ID of the project to delete"),
    }),
    toCode: (args) =>
      `print(apis.todoist.delete_project(project_id=${formatPythonArg(args.project_id)}))`,
  },
  {
    name: "todoist_list_tasks",
    description: "List tasks, optionally filtered by project.",
    schema: z.object({
      project_id: z.string().optional().describe("Filter by project ID"),
    }),
    toCode: (args) => {
      const params = args.project_id
        ? `project_id=${formatPythonArg(args.project_id)}`
        : "";
      return `print(apis.todoist.list_tasks(${params}))`;
    },
  },
  {
    name: "todoist_get_task",
    description: "Get details of a specific task.",
    schema: z.object({
      task_id: z.string().describe("The ID of the task"),
    }),
    toCode: (args) =>
      `print(apis.todoist.get_task(task_id=${formatPythonArg(args.task_id)}))`,
  },
  {
    name: "todoist_add_task",
    description: "Add a new task.",
    schema: z.object({
      content: z.string().describe("Task content/title"),
      project_id: z.string().optional().describe("Project to add task to"),
      due_string: z.string().optional().describe("Due date string (e.g., 'tomorrow', 'next monday')"),
      priority: z.number().optional().describe("Priority (1-4, 4 is highest)"),
      description: z.string().optional().describe("Task description"),
    }),
    toCode: (args) => {
      const params = [`content=${formatPythonArg(args.content)}`];
      if (args.project_id) params.push(`project_id=${formatPythonArg(args.project_id)}`);
      if (args.due_string) params.push(`due_string=${formatPythonArg(args.due_string)}`);
      if (args.priority) params.push(`priority=${args.priority}`);
      if (args.description) params.push(`description=${formatPythonArg(args.description)}`);
      return `print(apis.todoist.add_task(${params.join(", ")}))`;
    },
  },
  {
    name: "todoist_update_task",
    description: "Update an existing task.",
    schema: z.object({
      task_id: z.string().describe("The ID of the task to update"),
      content: z.string().optional().describe("New task content"),
      due_string: z.string().optional().describe("New due date string"),
      priority: z.number().optional().describe("New priority"),
    }),
    toCode: (args) => {
      const params = [`task_id=${formatPythonArg(args.task_id)}`];
      if (args.content) params.push(`content=${formatPythonArg(args.content)}`);
      if (args.due_string) params.push(`due_string=${formatPythonArg(args.due_string)}`);
      if (args.priority) params.push(`priority=${args.priority}`);
      return `print(apis.todoist.update_task(${params.join(", ")}))`;
    },
  },
  {
    name: "todoist_complete_task",
    description: "Mark a task as complete.",
    schema: z.object({
      task_id: z.string().describe("The ID of the task to complete"),
    }),
    toCode: (args) =>
      `print(apis.todoist.complete_task(task_id=${formatPythonArg(args.task_id)}))`,
  },
  {
    name: "todoist_uncomplete_task",
    description: "Mark a task as incomplete.",
    schema: z.object({
      task_id: z.string().describe("The ID of the task"),
    }),
    toCode: (args) =>
      `print(apis.todoist.uncomplete_task(task_id=${formatPythonArg(args.task_id)}))`,
  },
  {
    name: "todoist_delete_task",
    description: "Delete a task.",
    schema: z.object({
      task_id: z.string().describe("The ID of the task to delete"),
    }),
    toCode: (args) =>
      `print(apis.todoist.delete_task(task_id=${formatPythonArg(args.task_id)}))`,
  },
];

// ============================================================================
// SIMPLE NOTE SERVICE
// ============================================================================

const simpleNoteFunctions: ServiceFunction[] = [
  {
    name: "simplenote_login",
    description: "Login to SimpleNote with username (email) and password. Returns access_token.",
    schema: z.object({
      username: z.string().describe("SimpleNote username (email address)"),
      password: z.string().describe("SimpleNote password"),
    }),
    toCode: (args) =>
      `print(apis.simple_note.login(username=${formatPythonArg(args.username)}, password=${formatPythonArg(args.password)}))`,
  },
  {
    name: "simplenote_search_notes",
    description: "Search notes by query. Requires authentication.",
    schema: z.object({
      username: z.string().describe("SimpleNote username (email)"),
      password: z.string().describe("SimpleNote password"),
      query: z.string().describe("Search query"),
    }),
    toCode: (args) =>
      makeAuthenticatedCall("simple_note", "search_notes", args.username, args.password, { query: args.query }),
  },
  {
    name: "simplenote_show_note",
    description: "Get a specific note by ID. Requires authentication.",
    schema: z.object({
      username: z.string().describe("SimpleNote username (email)"),
      password: z.string().describe("SimpleNote password"),
      note_id: z.number().describe("The ID of the note"),
    }),
    toCode: (args) =>
      makeAuthenticatedCall("simple_note", "show_note", args.username, args.password, { note_id: args.note_id }),
  },
  {
    name: "simplenote_create_note",
    description: "Create a new note. Requires authentication.",
    schema: z.object({
      username: z.string().describe("SimpleNote username (email)"),
      password: z.string().describe("SimpleNote password"),
      title: z.string().describe("Note title"),
      content: z.string().describe("Note content"),
    }),
    toCode: (args) =>
      makeAuthenticatedCall("simple_note", "create_note", args.username, args.password, {
        title: args.title,
        content: args.content,
      }),
  },
  {
    name: "simplenote_show_account",
    description: "Show SimpleNote account details. Requires authentication.",
    schema: z.object({
      username: z.string().describe("SimpleNote username (email)"),
      password: z.string().describe("SimpleNote password"),
    }),
    toCode: (args) =>
      makeAuthenticatedCall("simple_note", "show_account", args.username, args.password),
  },
];

// ============================================================================
// SPLITWISE SERVICE
// ============================================================================

const splitwiseFunctions: ServiceFunction[] = [
  {
    name: "splitwise_login",
    description: "Login to Splitwise with email and password.",
    schema: z.object({
      email: z.string().describe("Splitwise email address"),
      password: z.string().describe("Splitwise password"),
    }),
    toCode: (args) =>
      `print(apis.splitwise.login(email=${formatPythonArg(args.email)}, password=${formatPythonArg(args.password)}))`,
  },
  {
    name: "splitwise_show_account",
    description: "Show the current Splitwise account details.",
    schema: z.object({}),
    toCode: () => `print(apis.splitwise.show_account())`,
  },
  {
    name: "splitwise_get_balances",
    description: "Get balances with all friends.",
    schema: z.object({}),
    toCode: () => `print(apis.splitwise.get_balances())`,
  },
  {
    name: "splitwise_list_groups",
    description: "List all groups.",
    schema: z.object({}),
    toCode: () => `print(apis.splitwise.list_groups())`,
  },
  {
    name: "splitwise_get_group",
    description: "Get details of a specific group.",
    schema: z.object({
      group_id: z.string().describe("The ID of the group"),
    }),
    toCode: (args) =>
      `print(apis.splitwise.get_group(group_id=${formatPythonArg(args.group_id)}))`,
  },
  {
    name: "splitwise_list_friends",
    description: "List all friends.",
    schema: z.object({}),
    toCode: () => `print(apis.splitwise.list_friends())`,
  },
  {
    name: "splitwise_add_expense",
    description: "Add a new expense.",
    schema: z.object({
      description: z.string().describe("Expense description"),
      amount: z.number().describe("Total amount"),
      group_id: z.string().optional().describe("Group ID (for group expenses)"),
      friend_id: z.string().optional().describe("Friend ID (for non-group expenses)"),
      split_equally: z.boolean().optional().describe("Split equally among members"),
    }),
    toCode: (args) => {
      const params = [
        `description=${formatPythonArg(args.description)}`,
        `amount=${args.amount}`,
      ];
      if (args.group_id) params.push(`group_id=${formatPythonArg(args.group_id)}`);
      if (args.friend_id) params.push(`friend_id=${formatPythonArg(args.friend_id)}`);
      if (args.split_equally !== undefined)
        params.push(`split_equally=${args.split_equally ? "True" : "False"}`);
      return `print(apis.splitwise.add_expense(${params.join(", ")}))`;
    },
  },
  {
    name: "splitwise_list_expenses",
    description: "List expenses.",
    schema: z.object({
      group_id: z.string().optional().describe("Filter by group"),
      friend_id: z.string().optional().describe("Filter by friend"),
      limit: z.number().optional().describe("Maximum number to return"),
    }),
    toCode: (args) => {
      const params: string[] = [];
      if (args.group_id) params.push(`group_id=${formatPythonArg(args.group_id)}`);
      if (args.friend_id) params.push(`friend_id=${formatPythonArg(args.friend_id)}`);
      if (args.limit) params.push(`limit=${args.limit}`);
      return `print(apis.splitwise.list_expenses(${params.join(", ")}))`;
    },
  },
  {
    name: "splitwise_get_expense",
    description: "Get details of a specific expense.",
    schema: z.object({
      expense_id: z.string().describe("The ID of the expense"),
    }),
    toCode: (args) =>
      `print(apis.splitwise.get_expense(expense_id=${formatPythonArg(args.expense_id)}))`,
  },
  {
    name: "splitwise_delete_expense",
    description: "Delete an expense.",
    schema: z.object({
      expense_id: z.string().describe("The ID of the expense to delete"),
    }),
    toCode: (args) =>
      `print(apis.splitwise.delete_expense(expense_id=${formatPythonArg(args.expense_id)}))`,
  },
  {
    name: "splitwise_settle_up",
    description: "Record a payment to settle up.",
    schema: z.object({
      friend_id: z.string().describe("Friend to settle with"),
      amount: z.number().describe("Amount paid"),
    }),
    toCode: (args) =>
      `print(apis.splitwise.settle_up(friend_id=${formatPythonArg(args.friend_id)}, amount=${args.amount}))`,
  },
];

// ============================================================================
// PHONE SERVICE
// ============================================================================

const phoneFunctions: ServiceFunction[] = [
  {
    name: "phone_show_contacts",
    description: "Show all phone contacts.",
    schema: z.object({}),
    toCode: () => `print(apis.phone.show_contacts())`,
  },
  {
    name: "phone_get_contact",
    description: "Get a specific contact by ID.",
    schema: z.object({
      contact_id: z.string().describe("The ID of the contact"),
    }),
    toCode: (args) =>
      `print(apis.phone.get_contact(contact_id=${formatPythonArg(args.contact_id)}))`,
  },
  {
    name: "phone_search_contacts",
    description: "Search contacts by name or number.",
    schema: z.object({
      query: z.string().describe("Search query"),
    }),
    toCode: (args) =>
      `print(apis.phone.search_contacts(query=${formatPythonArg(args.query)}))`,
  },
  {
    name: "phone_add_contact",
    description: "Add a new contact.",
    schema: z.object({
      name: z.string().describe("Contact name"),
      phone: z.string().describe("Phone number"),
      email: z.string().optional().describe("Email address"),
    }),
    toCode: (args) => {
      const params = [
        `name=${formatPythonArg(args.name)}`,
        `phone=${formatPythonArg(args.phone)}`,
      ];
      if (args.email) params.push(`email=${formatPythonArg(args.email)}`);
      return `print(apis.phone.add_contact(${params.join(", ")}))`;
    },
  },
  {
    name: "phone_update_contact",
    description: "Update an existing contact.",
    schema: z.object({
      contact_id: z.string().describe("The ID of the contact"),
      name: z.string().optional().describe("New name"),
      phone: z.string().optional().describe("New phone number"),
      email: z.string().optional().describe("New email"),
    }),
    toCode: (args) => {
      const params = [`contact_id=${formatPythonArg(args.contact_id)}`];
      if (args.name) params.push(`name=${formatPythonArg(args.name)}`);
      if (args.phone) params.push(`phone=${formatPythonArg(args.phone)}`);
      if (args.email) params.push(`email=${formatPythonArg(args.email)}`);
      return `print(apis.phone.update_contact(${params.join(", ")}))`;
    },
  },
  {
    name: "phone_delete_contact",
    description: "Delete a contact.",
    schema: z.object({
      contact_id: z.string().describe("The ID of the contact to delete"),
    }),
    toCode: (args) =>
      `print(apis.phone.delete_contact(contact_id=${formatPythonArg(args.contact_id)}))`,
  },
  {
    name: "phone_show_call_log",
    description: "Show call history.",
    schema: z.object({
      limit: z.number().optional().describe("Maximum number of calls to show"),
    }),
    toCode: (args) => {
      const params = args.limit ? `limit=${args.limit}` : "";
      return `print(apis.phone.show_call_log(${params}))`;
    },
  },
  {
    name: "phone_show_sms",
    description: "Show SMS messages.",
    schema: z.object({
      contact_id: z.string().optional().describe("Filter by contact"),
    }),
    toCode: (args) => {
      const params = args.contact_id
        ? `contact_id=${formatPythonArg(args.contact_id)}`
        : "";
      return `print(apis.phone.show_sms(${params}))`;
    },
  },
  {
    name: "phone_send_sms",
    description: "Send an SMS message.",
    schema: z.object({
      to: z.string().describe("Recipient phone number or contact ID"),
      message: z.string().describe("Message content"),
    }),
    toCode: (args) =>
      `print(apis.phone.send_sms(to=${formatPythonArg(args.to)}, message=${formatPythonArg(args.message)}))`,
  },
];

// ============================================================================
// FILE SYSTEM SERVICE
// ============================================================================

const fileSystemFunctions: ServiceFunction[] = [
  {
    name: "filesystem_list_files",
    description: "List files in a directory.",
    schema: z.object({
      path: z.string().optional().describe("Directory path (default: current directory)"),
    }),
    toCode: (args) => {
      const params = args.path ? `path=${formatPythonArg(args.path)}` : "";
      return `print(apis.file_system.list_files(${params}))`;
    },
  },
  {
    name: "filesystem_read_file",
    description: "Read the contents of a file.",
    schema: z.object({
      path: z.string().describe("File path"),
    }),
    toCode: (args) =>
      `print(apis.file_system.read_file(path=${formatPythonArg(args.path)}))`,
  },
  {
    name: "filesystem_write_file",
    description: "Write content to a file.",
    schema: z.object({
      path: z.string().describe("File path"),
      content: z.string().describe("Content to write"),
    }),
    toCode: (args) =>
      `print(apis.file_system.write_file(path=${formatPythonArg(args.path)}, content=${formatPythonArg(args.content)}))`,
  },
  {
    name: "filesystem_append_file",
    description: "Append content to a file.",
    schema: z.object({
      path: z.string().describe("File path"),
      content: z.string().describe("Content to append"),
    }),
    toCode: (args) =>
      `print(apis.file_system.append_file(path=${formatPythonArg(args.path)}, content=${formatPythonArg(args.content)}))`,
  },
  {
    name: "filesystem_delete_file",
    description: "Delete a file.",
    schema: z.object({
      path: z.string().describe("File path to delete"),
    }),
    toCode: (args) =>
      `print(apis.file_system.delete_file(path=${formatPythonArg(args.path)}))`,
  },
  {
    name: "filesystem_create_directory",
    description: "Create a new directory.",
    schema: z.object({
      path: z.string().describe("Directory path to create"),
    }),
    toCode: (args) =>
      `print(apis.file_system.create_directory(path=${formatPythonArg(args.path)}))`,
  },
  {
    name: "filesystem_delete_directory",
    description: "Delete a directory.",
    schema: z.object({
      path: z.string().describe("Directory path to delete"),
    }),
    toCode: (args) =>
      `print(apis.file_system.delete_directory(path=${formatPythonArg(args.path)}))`,
  },
  {
    name: "filesystem_move",
    description: "Move or rename a file/directory.",
    schema: z.object({
      source: z.string().describe("Source path"),
      destination: z.string().describe("Destination path"),
    }),
    toCode: (args) =>
      `print(apis.file_system.move(source=${formatPythonArg(args.source)}, destination=${formatPythonArg(args.destination)}))`,
  },
  {
    name: "filesystem_copy",
    description: "Copy a file.",
    schema: z.object({
      source: z.string().describe("Source path"),
      destination: z.string().describe("Destination path"),
    }),
    toCode: (args) =>
      `print(apis.file_system.copy(source=${formatPythonArg(args.source)}, destination=${formatPythonArg(args.destination)}))`,
  },
];

// ============================================================================
// SERVICE REGISTRY
// ============================================================================

export const services: Service[] = [
  {
    name: "spotify",
    displayName: "Spotify",
    description: "Music streaming service for playing, searching, and managing playlists",
    functions: spotifyFunctions,
  },
  {
    name: "gmail",
    displayName: "Gmail",
    description: "Email service for sending, receiving, and managing emails",
    functions: gmailFunctions,
  },
  {
    name: "venmo",
    displayName: "Venmo",
    description: "Payment service for sending and receiving money",
    functions: venmoFunctions,
  },
  {
    name: "amazon",
    displayName: "Amazon",
    description: "E-commerce service for shopping and order management",
    functions: amazonFunctions,
  },
  {
    name: "todoist",
    displayName: "Todoist",
    description: "Task management service for creating and organizing tasks",
    functions: todoistFunctions,
  },
  {
    name: "simple_note",
    displayName: "SimpleNote",
    description: "Note-taking service for creating and managing notes",
    functions: simpleNoteFunctions,
  },
  {
    name: "splitwise",
    displayName: "Splitwise",
    description: "Expense sharing service for splitting bills with friends",
    functions: splitwiseFunctions,
  },
  {
    name: "phone",
    displayName: "Phone",
    description: "Phone service for contacts, calls, and SMS",
    functions: phoneFunctions,
  },
  {
    name: "file_system",
    displayName: "File System",
    description: "File management for reading, writing, and organizing files",
    functions: fileSystemFunctions,
  },
];

// Get all functions for enabled services
export function getEnabledFunctions(enabledServices: string[]): ServiceFunction[] {
  const functions: ServiceFunction[] = [...baseTools];

  for (const service of services) {
    if (enabledServices.includes(service.name)) {
      functions.push(...service.functions);
    }
  }

  return functions;
}

// Get function by name (includes internal execute_python for backwards compatibility)
export function getFunctionByName(name: string): ServiceFunction | undefined {
  // Check base tools
  const baseTool = baseTools.find((t) => t.name === name);
  if (baseTool) return baseTool;

  // Check internal execute_python tool (not exposed to model but can be called)
  if (name === "execute_python") return executePythonTool;

  // Check service functions
  for (const service of services) {
    const fn = service.functions.find((f) => f.name === name);
    if (fn) return fn;
  }

  return undefined;
}

// Convert service functions to tool format for LLMs
export function functionsToTools(
  functions: ServiceFunction[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Array<{ name: string; description: string; parameters: Record<string, any> }> {
  return functions.map((fn) => ({
    name: fn.name,
    description: fn.description,
    parameters: zodToJsonSchema(fn.schema),
  }));
}

// Generate system prompt based on enabled services
export function generateSystemPrompt(enabledServiceNames: string[]): string {
  const enabledServiceDisplayNames = services
    .filter((s) => enabledServiceNames.includes(s.name))
    .map((s) => s.displayName);

  const servicesText = enabledServiceDisplayNames.length > 0
    ? enabledServiceDisplayNames.join(", ")
    : "None";

  return `You are an AI assistant with access to various services and APIs in a simulated environment. Your goal is to help the user complete tasks by using the available tools.

Available services: ${servicesText}.

IMPORTANT: Only use tools for the services listed above. Do not attempt to use tools for services that are not available.

When you need to perform actions:
1. Use supervisor_show_account_passwords to get login credentials for services
2. Login to the required services using the credentials
3. Use the appropriate service tools to interact with APIs
4. When finished, call supervisor_complete_task

Always explain what you're doing and why. If you encounter errors, try alternative approaches or explain what went wrong.`;
}

// Default agent preset
export const defaultAgentPreset = {
  id: "general",
  name: "General Agent",
  description: "Full access to all tools",
  enabledServices: services.map((s) => s.name),
  systemPrompt: generateSystemPrompt(services.map((s) => s.name)),
};
